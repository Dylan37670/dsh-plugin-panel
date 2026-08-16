/**
 * Plugin Panel — host half.
 *
 * Registers the `/api/plugin-panel` HTTP surface on the web server: catalog
 * (seed + live community index, cached on disk), installed detection,
 * favorites/settings state, and install/update/uninstall through the official
 * `dsh plugin` CLI with backup + rollback.
 *
 * The client half (see `src/client/client.js`) draws the sidebar entry and
 * the right-side drawer; all UI data flows over this HTTP API.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CatalogService } from "./catalog.js";
import { StateStore } from "./state.js";
import { createPanelHandler } from "./http.js";
import { findDshBin } from "./lifecycle.js";
import { TranslationStore } from "./translate.js";
import { VectorStore } from "./embeddings.js";
import { OperationStore } from "./operations.js";
export const name = '@dsh-community/plugin-panel';
/**
 * `webServer` is a hard dependency: the plugin's only job is the HTTP panel
 * surface, and the service is provided by the web-app bundle whose order in
 * the bundle stack is not guaranteed. With a hard inject, cordis holds the
 * plugin in waiting and reactivates it the moment `webServer` appears.
 */
export const inject = ['webServer'];
function dshHomeOf() {
    return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}
export function apply(ctx) {
    const dshHome = dshHomeOf();
    const catalog = new CatalogService(dshHome);
    const state = new StateStore(dshHome);
    const translations = new TranslationStore(dshHome);
    const vectors = new VectorStore(dshHome);
    const operations = new OperationStore(dshHome);
    void state.load();
    void translations.load();
    void vectors.load();
    void operations.load();
    const lifecycle = {
        dshHome,
        profile: state.get().settings.profile ?? 'web',
        dshBin: findDshBin(),
    };
    // `webServer` is declared as a hard inject, so by the time apply runs the
    // service is guaranteed present.
    const webServer = ctx.get('webServer');
    if (webServer === undefined) {
        throw new Error('plugin-panel: webServer unavailable despite hard inject');
    }
    // Optional on-demand translation route (v5): the harness LLM + the agent's
    // default model selection. Resolved LAZILY per request — at apply time the
    // llm/agentDefaultModel services may not be activated yet.
    const translate = {
        get: () => ({
            llm: ctx.get('llm'),
            route: ctx.get('agentDefaultModel')?.currentSelection?.(),
        }),
    };
    ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/api/plugin-panel',
        handler: createPanelHandler({
            catalog,
            state,
            lifecycle,
            profiles: ['web', 'headless'],
            translate,
            translations,
            vectors,
            operations,
        }),
    }), 'plugin-panel: HTTP routes');
    ctx.logger?.info?.('[plugin-panel] host half active (catalog dir: %s)', catalog.dir);
}
