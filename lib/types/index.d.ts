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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "@dsh-community/plugin-panel";
/**
 * `webServer` is a hard dependency: the plugin's only job is the HTTP panel
 * surface, and the service is provided by the web-app bundle whose order in
 * the bundle stack is not guaranteed. With a hard inject, cordis holds the
 * plugin in waiting and reactivates it the moment `webServer` appears.
 */
export declare const inject: string[];
export declare function apply(ctx: Context): void;
