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
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const PNPM_VERSION = '11';
/** Run one command with a timeout; capture stdout+stderr. */
function runCommand(file, args, cwd, timeoutMs) {
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, { cwd, shell: false, windowsHide: true, env: safeEnv() });
        const chunks = [];
        child.stdout?.on('data', (chunk) => chunks.push(chunk));
        child.stderr?.on('data', (chunk) => chunks.push(chunk));
        const timer = setTimeout(() => {
            child.kill();
        }, timeoutMs);
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code, output: Buffer.concat(chunks).toString('utf8') });
        });
    });
}
/** Windows-safe command runner: never depends on cmd.exe being on PATH. */
function winCmd(args) {
    return {
        file: process.env.ComSpec ?? 'C:\\Windows\\system32\\cmd.exe',
        args: ['/d', '/s', '/c', args.map((a) => /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a).join(' ')],
    };
}
/** Spawn-safe env: guarantee the Windows system directories exist. */
function safeEnv() {
    const env = { ...process.env };
    if (process.platform === 'win32') {
        env.SystemRoot ??= 'C:\\Windows';
        env.ComSpec ??= 'C:\\Windows\\system32\\cmd.exe';
        if (!env.Path && env.PATH)
            env.Path = env.PATH;
        if (!env.PATH && env.Path)
            env.PATH = env.Path;
    }
    return env;
}
/**
 * Run a bare executable (node, pnpm, npm) with a timeout.
 *
 * Windows note: a bare command with no extension (e.g. `pnpm`) resolves to a
 * `.cmd` shim via PATHEXT, which Node cannot spawn with `shell: false` — route
 * it through `cmd.exe` like the explicit `.cmd`/`.bat` case.
 */
export function run(file, args, cwd, timeoutMs = 300_000) {
    const needsCmd = process.platform === 'win32' &&
        (/\.(cmd|bat)$/i.test(file) || !file.includes('.') || !/[/\\]/.test(file));
    const command = needsCmd ? winCmd([file, ...args]) : { file, args };
    return runCommand(command.file, command.args, cwd, timeoutMs);
}
/** Run node with a script path (no shell involved). */
export function runNode(script, args, cwd, timeoutMs = 300_000) {
    return runCommand(process.execPath, [script, ...args], cwd, timeoutMs);
}
/** Locate the running DSH CLI entry (bin.js). */
export function findDshBin() {
    const argvBin = process.argv[1];
    if (argvBin && /[\\/]bin\.js$/.test(argvBin) && existsSync(argvBin))
        return argvBin;
    if (process.env.DSH_BIN && existsSync(process.env.DSH_BIN))
        return process.env.DSH_BIN;
    try {
        const require = createRequire(import.meta.url);
        const pkgPath = require.resolve('@deepseek-ai/dsh/package.json');
        const candidate = join(dirname(pkgPath), 'lib', 'bin.js');
        if (existsSync(candidate))
            return candidate;
    }
    catch {
        /* fall through */
    }
    return undefined;
}
/** Whether pnpm is available on PATH (the dsh plugin forwarder needs it). */
export async function checkPnpm() {
    try {
        const result = await run('pnpm', ['--version'], process.cwd(), 20_000);
        return result.code === 0;
    }
    catch {
        return false;
    }
}
/** One-click pnpm setup (npm global install) — the dsh-market style fix. */
export async function setupPnpm() {
    const installer = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    try {
        const result = await run(installer, ['install', '-g', `pnpm@${PNPM_VERSION}`], process.cwd(), 300_000);
        return {
            ok: result.code === 0,
            command: `${installer} install -g pnpm@${PNPM_VERSION}`,
            output: result.output,
            message: result.code === 0 ? 'pnpm 已安装，可重试插件安装。' : 'pnpm 安装失败，请手动安装 pnpm。',
        };
    }
    catch (error) {
        return {
            ok: false,
            command: `${installer} install -g pnpm@${PNPM_VERSION}`,
            output: String(error),
            message: '无法启动 npm 安装 pnpm。',
        };
    }
}
async function readProfile(ctx) {
    try {
        return JSON.parse(await readFile(join(ctx.dshHome, 'profiles', ctx.profile, 'package.json'), 'utf8'));
    }
    catch {
        return {};
    }
}
async function readOptional(file) {
    try {
        return await readFile(file, 'utf8');
    }
    catch {
        return '';
    }
}
/** Git/GitHub specs must be reused verbatim; only npm package names get @latest. */
export function updateTarget(name, spec) {
    const value = (spec || name).trim();
    const git = /^(?:github:|git(?:\+[^:]+)?:|https?:\/\/.*github\.com\/|ssh:\/\/|git@)/i.test(value) || /\.git(?:#.*)?$/i.test(value);
    if (git)
        return value;
    const bare = value.startsWith('@') ? value.lastIndexOf('@') <= 0 : !value.includes('@');
    return bare ? `${value}@latest` : value.replace(/@[^@/]+$/, '@latest');
}
function dependencyCandidates(before, after, spec) {
    const oldDeps = before.dependencies ?? {};
    const deps = after.dependencies ?? {};
    const added = Object.keys(deps).filter((name) => !(name in oldDeps));
    if (added.length)
        return added;
    const exact = Object.keys(deps).filter((name) => name === spec || deps[name] === spec);
    if (exact.length)
        return exact;
    const slug = spec.replace(/^github:/, '').replace(/[#/\\]+$/, '').split('/').pop()?.replace(/\.git$/i, '');
    return Object.keys(deps).filter((name) => name.split('/').pop() === slug);
}
/** Verify the postcondition DSH needs to activate a profile Bundle. */
export async function verifyBundle(ctx, packageName) {
    const profile = await readProfile(ctx);
    if (!(packageName in (profile.dependencies ?? {})))
        return { ok: false, reason: '依赖没有写入 profile' };
    if (!(profile.dsh?.profile?.bundles ?? []).includes(packageName))
        return { ok: false, reason: '未启用：缺少 dsh.bundle' };
    const packageFile = join(ctx.dshHome, 'profiles', ctx.profile, 'node_modules', packageName, 'package.json');
    let manifest;
    try {
        manifest = JSON.parse(await readFile(packageFile, 'utf8'));
    }
    catch {
        return { ok: false, reason: '找不到已安装包的 package.json' };
    }
    if (manifest.name && manifest.name !== packageName)
        return { ok: false, reason: `真实包名不匹配：${manifest.name}` };
    const patch = manifest.dsh?.bundle?.patch;
    if (!patch)
        return { ok: false, reason: '未启用：缺少 dsh.bundle.patch' };
    if (!existsSync(join(dirname(packageFile), patch)))
        return { ok: false, reason: `Bundle 补丁文件不存在：${patch}` };
    return { ok: true };
}
/** Copy the profile composition files into a timestamped backup directory. */
export async function backupProfile(ctx) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(ctx.dshHome, 'plugin-panel', 'backups', stamp, ctx.profile);
    await mkdir(backupDir, { recursive: true });
    const profileDir = join(ctx.dshHome, 'profiles', ctx.profile);
    const candidates = ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
    const files = [];
    for (const name of candidates) {
        const src = join(profileDir, name);
        if (!existsSync(src))
            continue;
        await copyFile(src, join(backupDir, name));
        files.push(name);
    }
    return { path: backupDir, files };
}
/** Restore a backup's files back into the profile directory. */
export async function restoreBackup(ctx, backup) {
    const profileDir = join(ctx.dshHome, 'profiles', ctx.profile);
    for (const name of backup.files) {
        const src = join(backup.path, name);
        if (!existsSync(src))
            continue;
        await copyFile(src, join(profileDir, name));
    }
}
/** Run `dsh plugin --profile <p> <args...>`. */
export async function runDshPlugin(ctx, args, timeoutMs = 120_000) {
    const dshBin = ctx.dshBin ?? findDshBin();
    if (!dshBin)
        throw new Error('找不到 dsh CLI（未设置 DSH_BIN，也不在运行进程中）');
    const node = process.execPath;
    const profileDir = join(ctx.dshHome, 'profiles', ctx.profile);
    return runNode(dshBin, ['plugin', '--profile', ctx.profile, ...args], profileDir, timeoutMs);
}
/** Install a plugin spec into the profile via the official command. */
export async function installPlugin(ctx, spec, label) {
    const backup = await backupProfile(ctx);
    const before = await readProfile(ctx);
    const command = `dsh plugin --profile ${ctx.profile} add ${spec}`;
    try {
        const result = await runDshPlugin(ctx, ['add', spec], 120_000);
        const after = await readProfile(ctx);
        const packageName = dependencyCandidates(before, after, spec)[0];
        const verification = packageName ? await verifyBundle(ctx, packageName) : { ok: false, reason: '无法确认真实包名' };
        if (result.code === 0 && packageName && verification.ok) {
            return {
                ok: true,
                command,
                output: result.output,
                backupPath: backup.path,
                packageName,
                message: `已安装 ${label}（安装后需重启 GUI 生效）。`,
            };
        }
        if (packageName && !(packageName in (before.dependencies ?? {}))) {
            await runDshPlugin(ctx, ['remove', packageName]).catch(() => undefined);
        }
        await restoreBackup(ctx, backup);
        return {
            ok: false,
            command,
            output: result.output,
            backupPath: backup.path,
            rolledBack: true,
            packageName,
            message: result.code === 0
                ? `安装未生效：${verification.reason ?? '结果校验失败'}；已回滚。`
                : `安装命令失败，已回滚到备份（${backup.path}）。`,
        };
    }
    catch (error) {
        await restoreBackup(ctx, backup).catch(() => undefined);
        return {
            ok: false,
            command,
            output: String(error),
            backupPath: backup.path,
            rolledBack: true,
            message: `安装异常，已回滚到备份：${String(error)}`,
        };
    }
}
/** Update a plugin (best-effort latest) via the official command. */
export async function updatePlugin(ctx, name, spec) {
    const backup = await backupProfile(ctx);
    const target = updateTarget(name, spec);
    const lockFile = join(ctx.dshHome, 'profiles', ctx.profile, 'pnpm-lock.yaml');
    const beforeLock = await readOptional(lockFile);
    const command = `dsh plugin --profile ${ctx.profile} add ${target}`;
    try {
        const result = await runDshPlugin(ctx, ['add', target], 120_000);
        const verification = await verifyBundle(ctx, name);
        if (result.code === 0 && verification.ok) {
            const changed = beforeLock !== await readOptional(lockFile);
            return {
                ok: true,
                command,
                output: result.output,
                backupPath: backup.path,
                packageName: name,
                alreadyLatest: !changed,
                message: changed ? `已更新 ${name}（需重启 GUI 生效）。` : `${name} 已经是最新版。`,
            };
        }
        await restoreBackup(ctx, backup);
        return {
            ok: false,
            command,
            output: result.output,
            backupPath: backup.path,
            rolledBack: true,
            packageName: name,
            message: result.code === 0 ? `更新后校验失败：${verification.reason ?? '未知原因'}；已回滚。` : `更新失败，已回滚到备份（${backup.path}）。`,
        };
    }
    catch (error) {
        await restoreBackup(ctx, backup).catch(() => undefined);
        return {
            ok: false,
            command,
            output: String(error),
            backupPath: backup.path,
            rolledBack: true,
            message: `更新异常，已回滚到备份：${String(error)}`,
        };
    }
}
/** Uninstall a plugin via the official command. */
export async function uninstallPlugin(ctx, name) {
    const backup = await backupProfile(ctx);
    const command = `dsh plugin --profile ${ctx.profile} remove ${name}`;
    try {
        const result = await runDshPlugin(ctx, ['remove', name]);
        const after = await readProfile(ctx);
        const removed = !(name in (after.dependencies ?? {})) && !(after.dsh?.profile?.bundles ?? []).includes(name);
        if (result.code === 0 && removed) {
            return {
                ok: true,
                command,
                output: result.output,
                backupPath: backup.path,
                packageName: name,
                message: `已卸载 ${name}（需重启 GUI 生效）。`,
            };
        }
        await restoreBackup(ctx, backup);
        return {
            ok: false,
            command,
            output: result.output,
            backupPath: backup.path,
            rolledBack: true,
            packageName: name,
            message: result.code === 0 ? `卸载结果校验失败，已回滚到备份（${backup.path}）。` : `卸载失败，已回滚到备份（${backup.path}）。`,
        };
    }
    catch (error) {
        await restoreBackup(ctx, backup).catch(() => undefined);
        return {
            ok: false,
            command,
            output: String(error),
            backupPath: backup.path,
            rolledBack: true,
            message: `卸载异常，已回滚到备份：${String(error)}`,
        };
    }
}
/** Read a JSON request body from an incoming HTTP request. */
export async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    if (chunks.length === 0)
        return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        return {};
    }
}
/** Atomically write a text file (used by the self-update of settings files). */
export async function atomicWriteText(file, content) {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, file);
}
