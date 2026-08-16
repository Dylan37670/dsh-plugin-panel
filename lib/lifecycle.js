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
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readManualRegistrations } from "./installed.js";
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
    // pnpm can otherwise wait forever for an interactive confirmation while
    // the panel has no terminal attached.
    env.CI = 'true';
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
    if (/^(?:link|file|workspace|portal|patch):/i.test(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('./') || value.startsWith('../'))
        return value;
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
    const missing = [];
    for (const name of candidates) {
        const src = join(profileDir, name);
        if (!existsSync(src)) {
            missing.push(name);
            continue;
        }
        await copyFile(src, join(backupDir, name));
        files.push(name);
    }
    return { path: backupDir, files, missing };
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
    for (const name of backup.missing)
        await rm(join(profileDir, name), { force: true }).catch(() => undefined);
}
function pnpmFailureHint(output) {
    if (output.includes('ERR_PNPM_IGNORED_BUILDS') || output.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')) {
        return '插件需要执行构建脚本，但被 pnpm 的安全策略拦截。请按错误中列出的包名在 profile/pnpm-workspace.yaml 的 allowBuilds 中明确放行后重试。';
    }
    if (output.includes('ERR_PNPM_FETCH_404'))
        return '某个 profile 依赖在 npm 中不存在或需要登录；pnpm 会因此阻止所有安装，请检查 profile/package.json 中是否有上次失败留下的依赖。';
    if (output.includes('ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF'))
        return 'profile 的 node_modules 由不同版本的 pnpm 创建；自动重建后重试仍失败。';
    if (output.includes('ERR_PNPM_ADDING_TO_ROOT'))
        return '当前 pnpm 拒绝修改 workspace 根目录，请升级 pnpm 后重试。';
    return undefined;
}
/** Run `dsh plugin --profile <p> <args...>`. */
export async function runDshPlugin(ctx, args, timeoutMs = 900_000) {
    const dshBin = ctx.dshBin ?? findDshBin();
    if (!dshBin)
        throw new Error('找不到 dsh CLI（未设置 DSH_BIN，也不在运行进程中）');
    const node = process.execPath;
    const profileDir = join(ctx.dshHome, 'profiles', ctx.profile);
    const invoke = (next) => runNode(dshBin, ['plugin', '--profile', ctx.profile, ...next], profileDir, timeoutMs);
    let result = await invoke(args);
    if (result.code !== 0 && result.output.includes('ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF')) {
        const repaired = await invoke(['install', '--no-frozen-lockfile']);
        if (repaired.code === 0)
            result = await invoke(args);
    }
    if (result.code !== 0
        && (args[0] === 'add' || args[0] === 'remove')
        && (result.output.includes('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION') || result.output.includes('ERR_PNPM_NO_MATURE_MATCHING_VERSION'))) {
        result = await invoke([args[0], '--config.minimumReleaseAge=0', ...args.slice(1)]);
    }
    return result;
}
function panelManualBlock(packageName) {
    const quoted = JSON.stringify(packageName);
    const id = packageName.replace(/^@/, '').replace(/[^A-Za-z0-9_.-]+/g, '-').toLowerCase();
    return `# plugin-panel:manual ${quoted}\n- insert:\n    - id: ${JSON.stringify(`plugin-panel-${id}`)}\n      name: ${quoted}\n`;
}
async function appendPanelManual(ctx, packageName) {
    const file = join(ctx.dshHome, 'profiles', ctx.profile, 'cordis.patch.yml');
    const current = await readOptional(file);
    const block = panelManualBlock(packageName);
    if (current.includes(block.trim()))
        return;
    await atomicWriteText(file, `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}`);
}
async function removePanelManual(ctx, packageName) {
    const file = join(ctx.dshHome, 'profiles', ctx.profile, 'cordis.patch.yml');
    const current = await readOptional(file);
    const block = panelManualBlock(packageName);
    if (!current.includes(block))
        return false;
    await atomicWriteText(file, current.replace(block, '').replace(/\n{3,}/g, '\n\n'));
    return true;
}
/** Verify a legacy/user-layer Cordis host plugin before registering it. */
export async function verifyHostPlugin(ctx, packageName) {
    const packageDir = join(ctx.dshHome, 'profiles', ctx.profile, 'node_modules', packageName);
    let manifest;
    try {
        manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
    }
    catch {
        return { ok: false, reason: '找不到已安装包的 package.json' };
    }
    if (manifest.name && manifest.name !== packageName)
        return { ok: false, reason: `真实包名不匹配：${manifest.name}` };
    let entry = manifest.main;
    const rootExport = typeof manifest.exports === 'string' ? manifest.exports : manifest.exports?.['.'];
    if (!entry && typeof rootExport === 'string')
        entry = rootExport;
    if (!entry && rootExport && typeof rootExport === 'object')
        entry = Object.values(rootExport).find((value) => typeof value === 'string');
    entry ??= 'index.js';
    const entryFile = join(packageDir, entry);
    if (!existsSync(entryFile))
        return { ok: false, reason: `插件入口不存在：${entry}` };
    try {
        const mod = await import(__rewriteRelativeImportExtension(`${pathToFileURL(entryFile).href}?plugin-panel=${Date.now()}`));
        const fallback = mod.default;
        if (typeof mod.apply !== 'function' && typeof fallback?.apply !== 'function' && typeof mod.default !== 'function')
            return { ok: false, reason: '包没有可加载的 Cordis apply 入口' };
        return { ok: true };
    }
    catch (error) {
        return { ok: false, reason: `插件入口无法加载：${error instanceof Error ? error.message : String(error)}` };
    }
}
/** Install a plugin spec into the profile via the official command. */
export async function installPlugin(ctx, spec, label) {
    const backup = await backupProfile(ctx);
    const before = await readProfile(ctx);
    const command = `dsh plugin --profile ${ctx.profile} add ${spec}`;
    try {
        const result = await runDshPlugin(ctx, ['add', spec]);
        const after = await readProfile(ctx);
        const packageName = dependencyCandidates(before, after, spec)[0];
        let activation;
        let verification = packageName ? await verifyBundle(ctx, packageName) : { ok: false, reason: '无法确认真实包名' };
        if (result.code === 0 && packageName && verification.ok)
            activation = 'bundle';
        if (result.code === 0 && packageName && !verification.ok) {
            const host = await verifyHostPlugin(ctx, packageName);
            if (host.ok) {
                await appendPanelManual(ctx, packageName);
                const registered = await readManualRegistrations(ctx.dshHome, ctx.profile);
                verification = registered.get(packageName)?.panelManaged ? { ok: true } : { ok: false, reason: '写入用户配置后仍未检测到注册项' };
                if (verification.ok)
                    activation = 'manual';
            }
            else {
                verification = host;
            }
        }
        if (result.code === 0 && packageName && verification.ok && activation) {
            return {
                ok: true,
                command,
                output: result.output,
                backupPath: backup.path,
                packageName,
                activation,
                message: activation === 'bundle'
                    ? `已安装 ${label}（已加入 Profile Bundle，重启 GUI 生效）。`
                    : `已安装 ${label}（已通过用户配置注册，重启 GUI 生效）。`,
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
                : `${pnpmFailureHint(result.output) ?? '安装命令失败'}；已回滚到备份（${backup.path}）。`,
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
export async function updatePlugin(ctx, name, spec, manual = false) {
    const backup = await backupProfile(ctx);
    const target = updateTarget(name, spec);
    const lockFile = join(ctx.dshHome, 'profiles', ctx.profile, 'pnpm-lock.yaml');
    const beforeLock = await readOptional(lockFile);
    const command = `dsh plugin --profile ${ctx.profile} add ${target}`;
    try {
        const result = await runDshPlugin(ctx, ['add', target]);
        const verification = manual ? await verifyHostPlugin(ctx, name) : await verifyBundle(ctx, name);
        const registration = manual ? await readManualRegistrations(ctx.dshHome, ctx.profile) : undefined;
        const active = verification.ok && (!manual || registration?.has(name));
        if (result.code === 0 && active) {
            const changed = beforeLock !== await readOptional(lockFile);
            return {
                ok: true,
                command,
                output: result.output,
                backupPath: backup.path,
                packageName: name,
                activation: manual ? 'manual' : 'bundle',
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
            message: result.code === 0 ? `更新后校验失败：${verification.reason ?? '未知原因'}；已回滚。` : `${pnpmFailureHint(result.output) ?? '更新失败'}，已回滚到备份（${backup.path}）。`,
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
export async function uninstallPlugin(ctx, name, options = {}) {
    if (options.manual && !options.panelManaged) {
        return {
            ok: false,
            command: '',
            output: '',
            packageName: name,
            message: '这个插件由用户的 cordis.patch.yml 管理。为避免误删你的配置，面板不会自动卸载；请先手动移除对应注册项。',
        };
    }
    const backup = await backupProfile(ctx);
    const command = `dsh plugin --profile ${ctx.profile} remove ${name}`;
    try {
        const result = await runDshPlugin(ctx, ['remove', name]);
        if (result.code === 0 && options.manual)
            await removePanelManual(ctx, name);
        const after = await readProfile(ctx);
        const registrations = await readManualRegistrations(ctx.dshHome, ctx.profile);
        const removed = !(name in (after.dependencies ?? {})) && !(after.dsh?.profile?.bundles ?? []).includes(name) && !registrations.has(name);
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
            message: result.code === 0 ? `卸载结果校验失败，已回滚到备份（${backup.path}）。` : `${pnpmFailureHint(result.output) ?? '卸载失败'}，已回滚到备份（${backup.path}）。`,
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
