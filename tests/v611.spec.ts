import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, readCurrentVersion, selfSpec, selfUpdate, PANEL_PACKAGE, PANEL_DEFAULT_SPEC } from '../src/self-update.ts';

describe('v6.11 version compare', () => {
  it('orders numeric semver-ish versions', () => {
    expect(compareVersions('0.6.11', '0.6.10')).toBe(1);
    expect(compareVersions('0.6.10', '0.6.11')).toBe(-1);
    expect(compareVersions('0.6.10', '0.6.10')).toBe(0);
    expect(compareVersions('0.7.0', '0.6.99')).toBe(1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.6.10.1', '0.6.10')).toBe(1);
  });

  it('tolerates a leading v and missing segments', () => {
    expect(compareVersions('v0.6.11', '0.6.11')).toBe(0);
    expect(compareVersions('0.6', '0.6.0')).toBe(0);
  });
});

describe('v6.15 current version', () => {
  it('reads the running package version from its own package.json', async () => {
    expect(await readCurrentVersion()).toBe('0.6.15');
  });
});

describe('v6.11 self update flow', () => {
  let dir: string;
  let bin: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-v611-'));
    const profile = join(dir, 'profiles', 'web');
    await mkdir(profile, { recursive: true });
    // Fake dsh bin: `add` installs the panel as a proper bundle package.
    bin = join(dir, 'fake-dsh.mjs');
    await writeFile(bin, `
      import fs from 'node:fs'; import path from 'node:path';
      const args = process.argv.slice(2);
      const action = args[args.length - 2], value = args[args.length - 1];
      const file = path.join(process.cwd(), 'package.json'); const p = JSON.parse(fs.readFileSync(file, 'utf8'));
      p.dependencies ||= {}; p.dsh ||= { profile: { bundles: [] } }; p.dsh.profile.bundles ||= [];
      if (action === 'add') {
        const name = ${JSON.stringify(PANEL_PACKAGE)}; p.dependencies[name] = value;
        if (!p.dsh.profile.bundles.includes(name)) p.dsh.profile.bundles.push(name);
        const d = path.join(process.cwd(), 'node_modules', name); fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, version: '0.6.11', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
        fs.writeFileSync(path.join(d, 'cordis.patch.yml'), '- insert: []\\n');
        fs.writeFileSync(path.join(process.cwd(), 'pnpm-lock.yaml'), 'lockfileVersion: 9.0 # ' + Date.now());
      }
      fs.writeFileSync(file, JSON.stringify(p)); process.exit(0);
    `);
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('falls back to the GitHub default spec when the profile has none', async () => {
    await writeFile(join(dir, 'profiles', 'web', 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
    expect(await selfSpec({ dshHome: dir, profile: 'web', dshBin: bin })).toBe(PANEL_DEFAULT_SPEC);
  });

  it('reuses the recorded spec from the profile dependencies', async () => {
    await writeFile(join(dir, 'profiles', 'web', 'package.json'), JSON.stringify({
      dependencies: { [PANEL_PACKAGE]: 'github:Dylan37670/dsh-plugin-panel#v0.6.10' },
      dsh: { profile: { bundles: [PANEL_PACKAGE] } },
    }));
    expect(await selfSpec({ dshHome: dir, profile: 'web', dshBin: bin })).toBe('github:Dylan37670/dsh-plugin-panel#v0.6.10');
  });

  it('updates itself through the official lifecycle and asks for a restart', async () => {
    await writeFile(join(dir, 'profiles', 'web', 'package.json'), JSON.stringify({
      dependencies: { [PANEL_PACKAGE]: PANEL_DEFAULT_SPEC },
      dsh: { profile: { bundles: [PANEL_PACKAGE] } },
    }));
    const ctx = { dshHome: dir, profile: 'web', dshBin: bin };
    const result = await selfUpdate(ctx);
    expect(result).toMatchObject({ ok: true, packageName: PANEL_PACKAGE, activation: 'bundle', restartRequired: true });
    expect(result.message).toContain('重启 GUI');
  });
});
