import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogService } from '../src/catalog.ts';
import { StateStore } from '../src/state.ts';
import {
  backupProfile,
  restoreBackup,
  readJsonBody,
  findDshBin,
  type LifecycleContext,
} from '../src/lifecycle.ts';

describe('CatalogService cache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-catalog-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts from the seed without a cache', async () => {
    const svc = new CatalogService(dir);
    const snap = await svc.snapshot();
    expect(snap.source).toBe('seed');
    expect(snap.entries.length).toBeGreaterThan(20);
  });

  it('persists a fetched snapshot to disk and serves it from cache', async () => {
    const svc = new CatalogService(dir);
    const remote = await svc.fetchCurated(
      'data:application/json,' + encodeURIComponent(JSON.stringify({ entries: [
        { id: 'x/y', title: 'XY', description: 'd', category: 'plugin', tags: [] },
      ] })),
    );
    expect(remote.source).toBe('remote');
    // A new service instance reads the disk cache.
    const svc2 = new CatalogService(dir);
    const cached = await svc2.snapshot('curated');
    expect(cached.source).toBe('cache');
    expect(cached.entries.find((e) => e.id === 'x/y')).toBeTruthy();
  });
});

describe('StateStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-state-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('defaults, saves, reloads, toggles favorites', async () => {
    const store = new StateStore(dir);
    await store.load();
    expect(store.get().favorites).toEqual([]);
    await store.toggleFavorite('a/b');
    expect(store.get().favorites).toEqual(['a/b']);
    const store2 = new StateStore(dir);
    await store2.load();
    expect(store2.get().favorites).toEqual(['a/b']);
    await store2.toggleFavorite('a/b');
    expect(store2.get().favorites).toEqual([]);
  });
});

describe('lifecycle helpers', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-life-'));
    await mkdir(join(dir, 'profiles', 'web'), { recursive: true });
    await writeFile(join(dir, 'profiles', 'web', 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    }), 'utf8');
    await writeFile(join(dir, 'profiles', 'web', 'cordis.patch.yml'), '[]', 'utf8');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('backs up and restores profile composition files', async () => {
    const ctx: LifecycleContext = { dshHome: dir, profile: 'web' };
    const backup = await backupProfile(ctx);
    expect(backup.files).toContain('package.json');
    // Mutate, then restore.
    await writeFile(join(dir, 'profiles', 'web', 'package.json'), '{}', 'utf8');
    await restoreBackup(ctx, backup);
    const restored = JSON.parse(await readFile(join(dir, 'profiles', 'web', 'package.json'), 'utf8'));
    expect(restored.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base']);
  });

  it('reads JSON bodies', async () => {
    const body = await readJsonBody({
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('{"spec":"github:a/b"}');
      },
    } as never);
    expect(body).toEqual({ spec: 'github:a/b' });
  });

  it('finds the dsh bin from DSH_BIN', async () => {
    const fake = join(dir, 'bin.js');
    await writeFile(fake, '// fake', 'utf8');
    const prev = process.env.DSH_BIN;
    process.env.DSH_BIN = fake;
    try {
      expect(findDshBin()).toBe(fake);
    } finally {
      if (prev === undefined) delete process.env.DSH_BIN;
      else process.env.DSH_BIN = prev;
    }
  });
});
