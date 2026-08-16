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
import { type LifecycleContext } from './lifecycle.ts';
import type { LifecycleResult } from './types.ts';
export declare const PANEL_PACKAGE = "@dsh-community/plugin-panel";
export declare const PANEL_REPO = "Dylan37670/dsh-plugin-panel";
export declare const PANEL_DEFAULT_SPEC = "github:Dylan37670/dsh-plugin-panel";
/** Version of the running panel package (from its own package.json). */
export declare function readCurrentVersion(): Promise<string>;
/**
 * Numeric semver-ish compare: 0.6.11 > 0.6.10 > 0.6.9. Non-numeric segments
 * compare lexically after the numeric prefix; missing segments count as 0.
 */
export declare function compareVersions(a: string, b: string): number;
/** Fetch the upstream package.json version (main first, master fallback). */
export declare function fetchLatestVersion(signal?: AbortSignal): Promise<string>;
/** Wire shape returned by GET /self-version. */
export interface SelfStatus {
    current: string;
    latest: string | null;
    updateAvailable: boolean;
    /** Dependency spec the update reuses (profile record, else the GitHub default). */
    spec: string;
    /** Set when the remote check failed (current version is still reported). */
    checkError?: string;
    checkedAt: string;
}
/** Resolve the spec self-update replays against the target profile. */
export declare function selfSpec(ctx: LifecycleContext): Promise<string>;
/** GET /self-version payload: current + latest + whether an update exists. */
export declare function selfStatus(ctx: LifecycleContext, signal?: AbortSignal): Promise<SelfStatus>;
/**
 * POST /self-update: run the official update flow against the panel's own
 * package. `restartRequired` tells the client to show the restart reminder —
 * the running process keeps the old code until the GUI restarts.
 */
export declare function selfUpdate(ctx: LifecycleContext): Promise<LifecycleResult & {
    restartRequired?: boolean;
}>;
