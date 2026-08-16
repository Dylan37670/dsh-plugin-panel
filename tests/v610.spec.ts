import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectInstalled, readManualRegistrations } from '../src/installed.ts';
import { installPlugin, uninstallPlugin, updateTarget } from '../src/lifecycle.ts';
import { installSpecFromCommand, parseCommunityRegistry } from '../src/catalog.ts';

describe('v6.10 accurate install metadata', () => {
  it('uses the registered npm aggregate instead of a repository workspace root', () => {
    const entries = parseCommunityRegistry({ plugins: [{
      name: 'dsh-web-ui-all',
      owner: 'zhu1090093659',
      url: 'https://github.com/zhu1090093659/dsh-web-ui/tree/main/packages/dsh-web-ui-all',
      npm: '@linxin666/dsh-web-ui-all',
      install: 'dsh plugin --profile web add @linxin666/dsh-web-ui-all',
      description: { en: 'UI collection' },
    }] });
    expect(entries[0]).toMatchObject({ install: '@linxin666/dsh-web-ui-all', installVerified: true, installSource: 'community' });
  });

  it('accepts only a single official add command shape', () => {
    expect(installSpecFromCommand('dsh plugin --profile web add github:a/b')).toBe('github:a/b');
    expect(installSpecFromCommand('dsh plugin --profile web add x; echo bad')).toBeUndefined();
    expect(installSpecFromCommand('npm install something')).toBeUndefined();
  });
});

describe('v6.10 profile lifecycle', () => {
  let dir: string;
  let bin: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-v610-'));
    const profile = join(dir, 'profiles', 'web');
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
    bin = join(dir, 'fake-dsh.mjs');
    await writeFile(bin, `
      import fs from 'node:fs'; import path from 'node:path';
      const action = process.argv[process.argv.length - 2], value = process.argv[process.argv.length - 1];
      const file = path.join(process.cwd(), 'package.json'); const p = JSON.parse(fs.readFileSync(file, 'utf8'));
      p.dependencies ||= {}; p.dsh ||= { profile: { bundles: [] } }; p.dsh.profile.bundles ||= [];
      if (action === 'add') {
        const name = 'manual-host'; p.dependencies[name] = value;
        const d = path.join(process.cwd(), 'node_modules', name); fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, main: 'index.mjs', dsh: { client: { platform: 'web' } } }));
        fs.writeFileSync(path.join(d, 'index.mjs'), 'export function apply() {}');
      } else if (action === 'remove') { delete p.dependencies[value]; p.dsh.profile.bundles = p.dsh.profile.bundles.filter(x => x !== value); }
      fs.writeFileSync(file, JSON.stringify(p)); process.exit(0);
    `);
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('recognizes an existing user patch as enabled without claiming ownership', async () => {
    const profile = join(dir, 'profiles', 'web');
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { existing: 'link:C:/plugin' }, dsh: { profile: { bundles: [] } } }));
    await writeFile(join(profile, 'cordis.patch.yml'), '- insert:\n    - id: existing\n      name: existing\n');
    const item = (await detectInstalled(dir, ['web'])).find((entry) => entry.name === 'existing');
    expect(item).toMatchObject({ enabled: true, activation: 'manual', panelManaged: false, issue: '已启用（用户配置注册）' });
  });

  it('installs a verified host plugin through a marked user-layer registration', async () => {
    const ctx = { dshHome: dir, profile: 'web', dshBin: bin };
    const result = await installPlugin(ctx, 'github:owner/manual-host', 'Manual host');
    expect(result).toMatchObject({ ok: true, packageName: 'manual-host', activation: 'manual' });
    const registrations = await readManualRegistrations(dir, 'web');
    expect(registrations.get('manual-host')).toMatchObject({ panelManaged: true });
    const item = (await detectInstalled(dir, ['web'])).find((entry) => entry.name === 'manual-host');
    expect(item).toMatchObject({ enabled: true, activation: 'manual', panelManaged: true });
    const removed = await uninstallPlugin(ctx, 'manual-host', { manual: true, panelManaged: true });
    expect(removed.ok).toBe(true);
    expect((await readManualRegistrations(dir, 'web')).has('manual-host')).toBe(false);
  });

  it('refuses to delete a user-owned manual registration', async () => {
    const profile = join(dir, 'profiles', 'web');
    const patch = '- insert:\n    - id: mine\n      name: mine\n';
    await writeFile(join(profile, 'cordis.patch.yml'), patch);
    const result = await uninstallPlugin({ dshHome: dir, profile: 'web', dshBin: bin }, 'mine', { manual: true, panelManaged: false });
    expect(result.ok).toBe(false);
    expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).toBe(patch);
  });

  it('keeps local link update targets unchanged', () => {
    expect(updateTarget('manual-host', 'link:C:/plugins/manual-host')).toBe('link:C:/plugins/manual-host');
  });
});
