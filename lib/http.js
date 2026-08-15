/**
 * HTTP layer: one prefix route `/api/plugin-panel` serving the panel's JSON
 * endpoints. Requests from non-loopback peers are rejected (the web server
 * binds 127.0.0.1 by default; this is a second, cheap guard).
 */
import { checkPnpm, setupPnpm, installPlugin, updatePlugin, uninstallPlugin, readJsonBody, } from "./lifecycle.js";
import { detectInstalled } from "./installed.js";
import { translateBatch } from "./translate.js";
import { buildIndex, indexCompatibilityIssue, semanticRank } from "./embeddings.js";
import { DEFAULT_EMBEDDING } from "./types.js";
/** Parse a lens from a query/body value ('all' → all-repos lens, else curated). */
function lensOf(value) {
    return value === 'all' ? 'all' : 'curated';
}
function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(payload);
}
function sendError(res, status, message) {
    sendJson(res, status, { ok: false, message });
}
/** Cheap loopback check on the request socket. */
function isLoopback(req) {
    const addr = req.socket.remoteAddress ?? '';
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr === '';
}
export function createPanelHandler(routes) {
    const { catalog, state, lifecycle, translate, translations, vectors } = routes;
    /** v6.4: in-flight lock so a vector-index build cannot run concurrently. */
    let embeddingBuildInFlight = false;
    /** Embedding config resolved from panel state at request time. */
    function embeddingConfig() {
        return state.get().settings.embedding ?? DEFAULT_EMBEDDING;
    }
    /** Catalog entries used for embedding (the full bundled index). */
    async function embeddableEntries() {
        const bundled = await catalog.readBundledAll();
        if (bundled)
            return bundled.entries;
        const snap = await catalog.snapshot('all');
        return snap.entries;
    }
    /** Lifecycle context re-resolved per request: the target profile follows the panel state. */
    function currentLifecycle() {
        return { ...lifecycle, profile: state.get().settings.profile || lifecycle.profile };
    }
    async function handleGet(path, url, res) {
        switch (path) {
            case '/catalog': {
                const lens = lensOf(url.searchParams.get('lens'));
                const snapshot = await catalog.snapshot(lens);
                const ageMs = await catalog.cacheAgeMs(lens);
                sendJson(res, 200, { ok: true, ...snapshot, cacheAgeMs: Number.isFinite(ageMs) ? ageMs : null });
                return;
            }
            case '/state': {
                const panelState = await state.load();
                sendJson(res, 200, { ok: true, state: panelState });
                return;
            }
            case '/installed': {
                const targetProfile = state.get().settings.profile;
                const profiles = [...new Set([targetProfile, ...routes.profiles])];
                const installed = await detectInstalled(lifecycle.dshHome, profiles);
                sendJson(res, 200, { ok: true, installed, profiles });
                return;
            }
            case '/env': {
                const dshBin = lifecycle.dshBin;
                const pnpmOk = await checkPnpm();
                sendJson(res, 200, {
                    ok: true,
                    dshFound: dshBin !== undefined,
                    pnpmFound: pnpmOk,
                    profile: lifecycle.profile,
                });
                return;
            }
            case '/embedding/status': {
                await state.load(); // ensure the saved config (incl. api key) is loaded
                const index = await vectors.load();
                const config = embeddingConfig();
                const entries = index ? await embeddableEntries() : undefined;
                const staleReason = index ? indexCompatibilityIssue(index, config, entries) : undefined;
                sendJson(res, 200, {
                    ok: true,
                    built: index !== undefined && index.vectors.length > 0 && !staleReason,
                    stale: !!staleReason,
                    staleReason: staleReason ?? null,
                    count: index?.vectors.length ?? 0,
                    model: index?.model ?? config.model,
                    provider: index?.provider ?? config.provider,
                    dim: index?.dim ?? 0,
                    builtAt: index?.builtAt ?? null,
                    enabled: config.enabled === true,
                    keySet: !!config.apiKey,
                });
                return;
            }
            default:
                sendError(res, 404, `unknown endpoint ${path}`);
        }
    }
    async function handlePost(path, req, res) {
        const body = (await readJsonBody(req));
        switch (path) {
            case '/refresh': {
                const url = typeof body.remoteCatalogUrl === 'string' ? body.remoteCatalogUrl : '';
                const lens = lensOf(body.lens);
                try {
                    if (lens === 'all') {
                        if (url.trim()) {
                            // v3: refresh = one fast download of the prebuilt catalog.
                            const snapshot = await catalog.fetchPrebuiltAll(url, AbortSignal.timeout(90_000));
                            sendJson(res, 200, { ok: true, ...snapshot });
                        }
                        else if (body.full === true) {
                            const snapshot = await catalog.fetchAllFull(AbortSignal.timeout(600_000));
                            sendJson(res, 200, { ok: true, ...snapshot });
                        }
                        else {
                            const bundled = await catalog.readBundledAll();
                            if (bundled) {
                                // No remote URL configured: the bundled index is already the
                                // complete list; refresh is a no-op with an explanatory note.
                                sendJson(res, 200, {
                                    ok: true,
                                    ...bundled,
                                    note: '内置预构建索引（构建于 ' + (bundled.fetchedAt ?? '未知') + '），无需联网刷新；如需在线更新，请在设置中填写远程目录 URL。',
                                });
                            }
                            else {
                                // No bundled index and no URL: last-resort fast GitHub crawl.
                                const snapshot = await catalog.fetchAll(AbortSignal.timeout(90_000));
                                sendJson(res, 200, { ok: true, ...snapshot });
                            }
                        }
                        return;
                    }
                    const snapshot = await catalog.fetchCurated(url, AbortSignal.timeout(60_000));
                    sendJson(res, 200, { ok: true, ...snapshot });
                }
                catch (error) {
                    catalog.invalidate(lens);
                    sendError(res, 502, `目录刷新失败：${error instanceof Error ? error.message : String(error)}`);
                }
                return;
            }
            case '/state': {
                const next = body.state;
                if (!next) {
                    sendError(res, 400, 'missing state');
                    return;
                }
                const saved = await state.save(next);
                sendJson(res, 200, { ok: true, state: saved });
                return;
            }
            case '/favorite': {
                const id = typeof body.id === 'string' ? body.id : '';
                if (!id) {
                    sendError(res, 400, 'missing id');
                    return;
                }
                const favorites = await state.toggleFavorite(id);
                sendJson(res, 200, { ok: true, favorites });
                return;
            }
            case '/install': {
                const spec = typeof body.spec === 'string' ? body.spec : '';
                const label = typeof body.label === 'string' ? body.label : spec;
                if (!spec) {
                    sendError(res, 400, 'missing spec');
                    return;
                }
                const result = await installPlugin(currentLifecycle(), spec, label);
                sendJson(res, result.ok ? 200 : 500, result);
                return;
            }
            case '/update': {
                const name = typeof body.name === 'string' ? body.name : '';
                const spec = typeof body.spec === 'string' ? body.spec : undefined;
                if (!name) {
                    sendError(res, 400, 'missing name');
                    return;
                }
                const result = await updatePlugin(currentLifecycle(), name, spec);
                sendJson(res, result.ok ? 200 : 500, result);
                return;
            }
            case '/uninstall': {
                const name = typeof body.name === 'string' ? body.name : '';
                if (!name) {
                    sendError(res, 400, 'missing name');
                    return;
                }
                const result = await uninstallPlugin(currentLifecycle(), name);
                sendJson(res, result.ok ? 200 : 500, result);
                return;
            }
            case '/fix-pnpm': {
                const result = await setupPnpm();
                sendJson(res, result.ok ? 200 : 500, result);
                return;
            }
            case '/translate': {
                const items = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
                if (items.length === 0) {
                    sendJson(res, 200, { ok: true, results: [] });
                    return;
                }
                const route = translate.get(); // resolve services per request
                const results = await translateBatch(route, translations, items, AbortSignal.timeout(120_000));
                const returned = new Set(results.map((item) => item.id));
                const missingIds = items.map((item) => item.id).filter((id) => !returned.has(id));
                sendJson(res, 200, {
                    ok: true,
                    results,
                    complete: missingIds.length === 0,
                    missingIds,
                    llmAvailable: route.llm !== undefined,
                    modelRoute: route.route ? `${route.route.provider}/${route.route.model}` : null,
                });
                return;
            }
            case '/embedding/build': {
                if (embeddingBuildInFlight) {
                    sendJson(res, 200, { ok: true, already: true, message: '索引构建已在进行中' });
                    return;
                }
                embeddingBuildInFlight = true;
                const config = embeddingConfig();
                try {
                    const entries = await embeddableEntries();
                    const index = await buildIndex(config, vectors, entries, AbortSignal.timeout(600_000));
                    sendJson(res, 200, { ok: true, count: index.vectors.length, model: index.model, dim: index.dim, builtAt: index.builtAt });
                }
                catch (error) {
                    sendError(res, 502, `索引构建失败：${error instanceof Error ? error.message : String(error)}`);
                }
                finally {
                    embeddingBuildInFlight = false;
                }
                return;
            }
            case '/search-semantic': {
                const query = typeof body.query === 'string' ? body.query.trim() : '';
                const limit = Math.min(200, Math.max(1, Number(body.limit ?? 60)));
                if (!query) {
                    sendJson(res, 200, { ok: true, results: [] });
                    return;
                }
                try {
                    const entries = await embeddableEntries();
                    const results = await semanticRank(embeddingConfig(), vectors, entries, query, limit, AbortSignal.timeout(60_000));
                    sendJson(res, 200, { ok: true, results });
                }
                catch (error) {
                    sendError(res, 502, `语义搜索失败：${error instanceof Error ? error.message : String(error)}`);
                }
                return;
            }
            default:
                sendError(res, 404, `unknown endpoint ${path}`);
        }
    }
    return async function panelHandler(req, res) {
        try {
            if (!isLoopback(req)) {
                sendError(res, 403, 'loopback only');
                return;
            }
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            const prefix = '/api/plugin-panel';
            if (!url.pathname.startsWith(prefix)) {
                sendError(res, 404, 'not a plugin-panel route');
                return;
            }
            const path = url.pathname.slice(prefix.length) || '/';
            if (req.method === 'GET') {
                await handleGet(path, url, res);
                return;
            }
            if (req.method === 'POST') {
                await handlePost(path, req, res);
                return;
            }
            sendError(res, 405, 'method not allowed');
        }
        catch (error) {
            sendError(res, 500, `internal: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
}
