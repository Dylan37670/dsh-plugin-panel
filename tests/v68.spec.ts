import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationStore } from '../src/operations.ts';
import { StateStore } from '../src/state.ts';
import { detectInstalled } from '../src/installed.ts';
import { installPlugin, uninstallPlugin, updateTarget } from '../src/lifecycle.ts';
import { CatalogService, DEFAULT_CURATED_CATALOG_URL } from '../src/catalog.ts';

describe('v6.8 persistence', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'pp-v68-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('keeps 100 sanitized operations, restores them, marks interrupted work, and clears', async () => {
    const store = new OperationStore(dir);
    for (let i = 0; i < 105; i += 1) {
      await store.upsert({ id: String(i), label: `op ${i}`, state: i === 104 ? 'running' : 'ok', detail: i === 103 ? 'Bearer very-secret-token-123456789' : '', startedAt: i });
    }
    expect(store.get()).toHaveLength(100);
    const restored = await new OperationStore(dir).load();
    expect(restored[0]).toMatchObject({ id: '104', state: 'error', detail: '上次运行被中断' });
    expect(restored.find((op) => op.id === '103')?.detail).not.toContain('very-secret');
    const next = new OperationStore(dir);
    await next.load();
    await next.clear();
    expect(await next.load()).toEqual([]);
  });

  it('deep-merges embedding settings without clearing key/model/url', async () => {
    const store = new StateStore(dir);
    await store.load();
    await store.patchSettings({ embedding: { enabled: true, provider: 'test', apiKey: 'secret', model: 'm', baseUrl: 'https://e.test/v1' } });
    await store.patchSettings({ catalogSource: 'all' });
    await store.patchSettings({ embedding: { enabled: false } as never });
    const reloaded = new StateStore(dir);
    await reloaded.load();
    expect(reloaded.get().settings.embedding).toMatchObject({ enabled: false, apiKey: 'secret', model: 'm', baseUrl: 'https://e.test/v1' });
    expect(reloaded.get().settings.catalogSource).toBe('all');
  });

  it('distinguishes enabled bundles from downloaded inactive dependencies', async () => {
    await mkdir(join(dir, 'profiles', 'web'), { recursive: true });
    await writeFile(join(dir, 'profiles', 'web', 'package.json'), JSON.stringify({
      dependencies: { good: '1.0.0', 'dsh-memory-evolve': 'github:x/y' },
      dsh: { profile: { bundles: ['good'] } },
    }));
    const items = await detectInstalled(dir, ['web']);
    expect(items.find((item) => item.name === 'good')).toMatchObject({ kind: 'bundle', enabled: true, packageName: 'good' });
    expect(items.find((item) => item.name === 'dsh-memory-evolve')).toMatchObject({ kind: 'dependency', enabled: false, issue: '仅下载，未加入 Profile' });
  });
});

describe('v6.8 lifecycle verification', () => {
  let dir: string;
  let bin: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-v68-life-'));
    const profile = join(dir, 'profiles', 'web');
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
    bin = join(dir, 'fake-dsh.mjs');
    await writeFile(bin, `
      import fs from 'node:fs'; import path from 'node:path';
      const action = process.argv[process.argv.length - 2], value = process.argv[process.argv.length - 1];
      const file = path.join(process.cwd(), 'package.json'); const p = JSON.parse(fs.readFileSync(file, 'utf8'));
      p.dependencies ||= {}; p.dsh ||= { profile: { bundles: [] } }; p.dsh.profile.bundles ||= [];
      const name = value.includes('plain') ? 'plain-client' : 'valid-bundle';
      if (action === 'add') {
        p.dependencies[name] = value;
        if (name === 'valid-bundle') {
          p.dsh.profile.bundles.push(name);
          const d = path.join(process.cwd(), 'node_modules', name); fs.mkdirSync(d, { recursive: true });
          fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, dsh: { bundle: { patch: './cordis.patch.yml' } } }));
          fs.writeFileSync(path.join(d, 'cordis.patch.yml'), '[]');
        }
      } else if (action === 'remove') { delete p.dependencies[value]; p.dsh.profile.bundles = p.dsh.profile.bundles.filter(x => x !== value); }
      fs.writeFileSync(file, JSON.stringify(p)); process.exit(0);
    `);
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('reuses GitHub specs and adds latest only to npm targets', () => {
    expect(updateTarget('pkg', 'github:a/b')).toBe('github:a/b');
    expect(updateTarget('@scope/pkg', '@scope/pkg')).toBe('@scope/pkg@latest');
    expect(updateTarget('pkg', 'pkg@1.2.0')).toBe('pkg@latest');
  });

  it('accepts a real bundle, removes by its exact package name, and verifies removal', async () => {
    const ctx = { dshHome: dir, profile: 'web', dshBin: bin };
    const installed = await installPlugin(ctx, 'github:owner/valid', 'Valid');
    expect(installed).toMatchObject({ ok: true, packageName: 'valid-bundle' });
    const removed = await uninstallPlugin(ctx, 'valid-bundle');
    expect(removed.ok).toBe(true);
  });

  it('rejects exit-code-zero client-only dependencies and restores the profile', async () => {
    const result = await installPlugin({ dshHome: dir, profile: 'web', dshBin: bin }, 'github:owner/plain', 'Plain');
    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.message).toContain('找不到已安装包');
    const profile = JSON.parse(await readFile(join(dir, 'profiles', 'web', 'package.json'), 'utf8'));
    expect(profile.dependencies).toEqual({});
  });
});

describe('v6.8 prebuilt catalog safety', () => {
  let dir: string;
  const entry = { id: 'a/b', title: 'b', description: 'd', category: 'plugin', tags: [] };
  const valid = { manifest: { schema: 'plugin-panel-catalog@1', generatedAt: new Date().toISOString(), totalHits: 1, fetchedCount: 1, count: 1, coveragePct: 100, gaps: 0 }, entries: [entry] };
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'pp-v68-cat-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
  function serviceWithoutBundled(): CatalogService {
    const svc = new CatalogService(dir);
    Object.defineProperty(svc, 'bundledAllPath', { value: () => join(dir, 'missing-catalog.json') });
    return svc;
  }

  it('uses HTTP validators and keeps the cached catalog on 304', async () => {
    const oldFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (async (_url, init) => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify(valid), { status: 200, headers: { etag: 'v1' } });
      expect(new Headers(init?.headers).get('if-none-match')).toBe('v1');
      return new Response(null, { status: 304 });
    }) as typeof fetch;
    try {
      const svc = serviceWithoutBundled();
      const first = await svc.fetchPrebuiltAll('https://example.test/catalog.json');
      const second = await svc.fetchPrebuiltAll('https://example.test/catalog.json');
      expect(second.entries).toEqual(first.entries);
    } finally { globalThis.fetch = oldFetch; }
  });

  it('downloads the maintained curated JSON when no custom URL is configured', async () => {
    const oldFetch = globalThis.fetch;
    let requested = '';
    const curated = { manifest: { schema: 'plugin-panel-curated@1', generatedAt: new Date().toISOString() }, entries: [entry] };
    globalThis.fetch = (async (url) => {
      requested = String(url);
      return new Response(JSON.stringify(curated), { status: 200 });
    }) as typeof fetch;
    try {
      const snapshot = await serviceWithoutBundled().fetchPrebuiltCurated('');
      expect(requested).toBe(DEFAULT_CURATED_CATALOG_URL);
      expect(snapshot.entries.some((item) => item.id === 'a/b')).toBe(true);
    } finally { globalThis.fetch = oldFetch; }
  });

  it('accepts a complete catalogue when GitHub reported total changes during the crawl', async () => {
    const oldFetch = globalThis.fetch;
    let payload: unknown = valid;
    globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
    try {
      const svc = serviceWithoutBundled();
      await svc.fetchPrebuiltAll('https://example.test/catalog.json');
      payload = { ...valid, manifest: { ...valid.manifest, totalHits: 1000, fetchedCount: 10 } };
      await expect(svc.fetchPrebuiltAll('https://example.test/catalog.json')).resolves.toMatchObject({ source: 'remote' });
      expect((await svc.snapshot('all')).entries.some((x) => x.id === 'a/b')).toBe(true);
    } finally { globalThis.fetch = oldFetch; }
  });

  it('rejects a large fetched-count shrink without replacing the good cache', async () => {
    const oldFetch = globalThis.fetch;
    let payload: unknown = { ...valid, manifest: { ...valid.manifest, totalHits: 100, fetchedCount: 100 } };
    globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
    try {
      const svc = serviceWithoutBundled();
      await svc.fetchPrebuiltAll('https://example.test/catalog.json');
      payload = { ...valid, manifest: { ...valid.manifest, totalHits: 100, fetchedCount: 10 } };
      await expect(svc.fetchPrebuiltAll('https://example.test/catalog.json')).rejects.toThrow('抓取数量异常缩水');
      expect((await svc.snapshot('all')).fetchedCount).toBe(100);
    } finally { globalThis.fetch = oldFetch; }
  });
});
