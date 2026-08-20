/**
 * Lifecycle operations: install / update / uninstall through the OFFICIAL
 * `dsh plugin` CLI, with confirmation handled client-side and host-side
 * backup + failure rollback.
 *
 * Safety model:
 *  - Before any mutation, `profiles/<profile>/package.json` (plus
 *    `cordis.patch.yml` and `pnpm-lock.yaml` when present) are copied to
 *    `$DSH_HOME/plugin-panel/backups/<timestamp>/<profile>/`.
 *  - On failure, the backup is restored and a best-effort reverse command is
 *    run so the profile composition returns to its previous state.
 *  - Rollback is best-effort by design: pnpm may leave lockfile/node_modules
 *    changes that only a subsequent `pnpm install` fully converges; the panel
 *    reports exactly what it restored and what it could not.
 */
import type { IncomingMessage } from 'node:http';
import type { LifecycleResult } from './types.ts';
interface SpawnResult {
    code: number | null;
    output: string;
}
/**
 * Run a bare executable (node, pnpm, npm) with a timeout.
 *
 * Windows note: a bare command with no extension (e.g. `pnpm`) resolves to a
 * `.cmd` shim via PATHEXT, which Node cannot spawn with `shell: false` — route
 * it through `cmd.exe` like the explicit `.cmd`/`.bat` case.
 */
export declare function run(file: string, args: string[], cwd: string, timeoutMs?: number): Promise<SpawnResult>;
/** Run node with a script path (no shell involved). */
export declare function runNode(script: string, args: string[], cwd: string, timeoutMs?: number): Promise<SpawnResult>;
/** Locate the running DSH CLI entry (bin.js). */
export declare function findDshBin(): string | undefined;
/** Whether pnpm is available on PATH (the dsh plugin forwarder needs it). */
export declare function checkPnpm(): Promise<boolean>;
/** One-click pnpm setup (npm global install) — the dsh-market style fix. */
export declare function setupPnpm(): Promise<LifecycleResult>;
export interface LifecycleContext {
    dshHome: string;
    profile: string;
    /** Override for tests. */
    dshBin?: string;
}
/** One backup snapshot of a profile's composition files. */
export interface BackupRef {
    path: string;
    files: string[];
    missing: string[];
}
/** Git/GitHub specs must be reused verbatim; only npm package names get @latest. */
export declare function updateTarget(name: string, spec?: string): string;
/** Verify the postcondition DSH needs to activate a profile Bundle. */
export declare function verifyBundle(ctx: LifecycleContext, packageName: string): Promise<{
    ok: boolean;
    reason?: string;
}>;
/** Copy the profile composition files into a timestamped backup directory. */
export declare function backupProfile(ctx: LifecycleContext): Promise<BackupRef>;
/** Restore a backup's files back into the profile directory. */
export declare function restoreBackup(ctx: LifecycleContext, backup: BackupRef): Promise<void>;
/** Only retry failures that are plausibly transient transport failures. */
export declare function isTransientUpdateFailure(output: string): boolean;
/** A useful but deliberately non-sensitive summary for the operation log. */
export declare function updateFailureHint(output: string, retried?: boolean): string;
/** Run `dsh plugin --profile <p> <args...>`. */
export declare function runDshPlugin(ctx: LifecycleContext, args: string[], timeoutMs?: number): Promise<SpawnResult>;
/** Verify a legacy/user-layer Cordis host plugin before registering it. */
export declare function verifyHostPlugin(ctx: LifecycleContext, packageName: string): Promise<{
    ok: boolean;
    reason?: string;
}>;
/** Install a plugin spec into the profile via the official command. */
export declare function installPlugin(ctx: LifecycleContext, spec: string, label: string): Promise<LifecycleResult>;
/** Update a plugin (best-effort latest) via the official command. */
export declare function updatePlugin(ctx: LifecycleContext, name: string, spec: string | undefined, manual?: boolean): Promise<LifecycleResult>;
/** Uninstall a plugin via the official command. */
export declare function uninstallPlugin(ctx: LifecycleContext, name: string, options?: {
    manual?: boolean;
    panelManaged?: boolean;
}): Promise<LifecycleResult>;
/** Read a JSON request body from an incoming HTTP request. */
export declare function readJsonBody(req: IncomingMessage): Promise<unknown>;
/** Atomically write a text file (used by the self-update of settings files). */
export declare function atomicWriteText(file: string, content: string): Promise<void>;
export {};
