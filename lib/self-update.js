/**
 * Panel self-update (v6.11).
 *
 * The panel can finally answer "is there a newer ME?" and act on it:
 *
 *  - `readCurrentVersion` reads the version of the RUNNING package from its
 *    own package.json (lib/../package.json, same depth from src/).
 *  - `fetchLatestVersion` downloads the upstream repository's package.json
 *    (main, then master) and reads its `version`.
 *  - `selfStatus` combines both with the dependency spec recorded in the
 *    target profile, caching the remote lookup briefly so an open drawer
 *    does not hammer GitHub on every render.
 *  - `selfUpdate` reuses the exact lifecycle the panel already applies to
 *    every other bundle: backup → `dsh plugin add <spec>` → verify →
 *    rollback on failure. The new code only takes effect after the GUI
 *    restarts; the client says so explicitly.
 */
import { readFile } from 'node:fs/promises';
import { updatePlugin } from "./lifecycle.js";
import { readProfileManifest } from "./installed.js";
export const PANEL_PACKAGE = '@dsh-community/plugin-panel';
export const PANEL_REPO = 'Dylan37670/dsh-plugin-panel';
export const PANEL_DEFAULT_SPEC = `github:${PANEL_REPO}`;
/** Version of the running panel package (from its own package.json). */
export async function readCurrentVersion() {
    try {
        const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
        return typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/**
 * Numeric semver-ish compare: 0.6.11 > 0.6.10 > 0.6.9. Non-numeric segments
 * compare lexically after the numeric prefix; missing segments count as 0.
 */
export function compareVersions(a, b) {
    const pa = a.replace(/^v/i, '').split('.');
    const pb = b.replace(/^v/i, '').split('.');
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
        const xa = pa[i] ?? '0';
        const xb = pb[i] ?? '0';
        const na = Number.parseInt(xa, 10);
        const nb = Number.parseInt(xb, 10);
        const aNum = Number.isNaN(na) ? -1 : na;
        const bNum = Number.isNaN(nb) ? -1 : nb;
        if (aNum !== bNum)
            return aNum < bNum ? -1 : 1;
        if (aNum === -1 && xa !== xb)
            return xa < xb ? -1 : 1;
    }
    return 0;
}
/** Fetch the upstream package.json version (main first, master fallback). */
export async function fetchLatestVersion(signal) {
    let lastError;
    for (const branch of ['main', 'master']) {
        try {
            const url = `https://raw.githubusercontent.com/${PANEL_REPO}/${branch}/package.json`;
            const response = await fetch(url, { signal, headers: { 'User-Agent': 'dsh-plugin-panel' } });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            const manifest = await response.json();
            if (typeof manifest.version === 'string' && manifest.version !== '')
                return manifest.version;
            throw new Error('上游 package.json 缺少 version 字段');
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
const LATEST_OK_TTL_MS = 10 * 60_000;
const LATEST_ERR_TTL_MS = 2 * 60_000;
let latestCache;
async function cachedLatest(signal) {
    const now = Date.now();
    if (latestCache) {
        const ttl = latestCache.latest !== undefined ? LATEST_OK_TTL_MS : LATEST_ERR_TTL_MS;
        if (now - latestCache.at < ttl)
            return { latest: latestCache.latest, error: latestCache.error };
    }
    try {
        const latest = await fetchLatestVersion(signal);
        latestCache = { at: now, latest };
        return { latest };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        latestCache = { at: now, error: message };
        return { error: message };
    }
}
/** Resolve the spec self-update replays against the target profile. */
export async function selfSpec(ctx) {
    const manifest = await readProfileManifest(ctx.dshHome, ctx.profile);
    const spec = manifest.dependencies?.[PANEL_PACKAGE];
    return typeof spec === 'string' && spec.trim() !== '' ? spec : PANEL_DEFAULT_SPEC;
}
/** GET /self-version payload: current + latest + whether an update exists. */
export async function selfStatus(ctx, signal) {
    const [current, spec, remote] = await Promise.all([
        readCurrentVersion(),
        selfSpec(ctx),
        cachedLatest(signal),
    ]);
    const latest = remote.latest ?? null;
    return {
        current,
        latest,
        updateAvailable: latest !== null && compareVersions(latest, current) > 0,
        spec,
        checkError: remote.error,
        checkedAt: new Date().toISOString(),
    };
}
/**
 * POST /self-update: run the official update flow against the panel's own
 * package. `restartRequired` tells the client to show the restart reminder —
 * the running process keeps the old code until the GUI restarts.
 */
export async function selfUpdate(ctx) {
    const spec = await selfSpec(ctx);
    const result = await updatePlugin(ctx, PANEL_PACKAGE, spec);
    if (result.ok)
        latestCache = undefined; // next check re-reads upstream
    const changed = result.ok && result.alreadyLatest !== true;
    return {
        ...result,
        restartRequired: changed,
        message: result.ok
            ? (changed ? `面板已更新（${result.packageName ?? PANEL_PACKAGE}），重启 GUI 后生效。` : result.message)
            : result.message,
    };
}
