import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogHash, cosine, embeddingEndpoint, entrySearchText, indexCompatibilityIssue, VectorStore } from '../src/embeddings.ts';
import type { CatalogEntry } from '../src/types.ts';

describe('cosine', () => {
  it('is 1 for identical vectors and 0 for orthogonal', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('orders similar above dissimilar', () => {
    const base = [1, 0, 0];
    expect(cosine(base, [0.9, 0.1, 0])).toBeGreaterThan(cosine(base, [0, 0.9, 0.1]));
  });

  it('rejects dimension mismatches instead of silently truncating', () => {
    expect(() => cosine([1, 2], [1])).toThrow(/维度不一致/);
  });
});

describe('embeddingEndpoint', () => {
  it('accepts a base URL or a complete endpoint', () => {
    expect(embeddingEndpoint('https://example.test/v1/')).toBe('https://example.test/v1/embeddings');
    expect(embeddingEndpoint('https://example.test/v1/embeddings')).toBe('https://example.test/v1/embeddings');
  });
});

describe('entrySearchText', () => {
  it('joins title, description and tags', () => {
    const entry: CatalogEntry = {
      id: 'a/b',
      title: 'Title',
      description: 'Desc',
      tags: ['x', 'y'],
      author: 'me',
      category: 'plugin',
    };
    const text = entrySearchText(entry);
    expect(text).toContain('Title');
    expect(text).toContain('Desc');
    expect(text).toContain('x');
    expect(text).toContain('me');
  });
});

describe('VectorStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-vec-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists an index and loads it back', async () => {
    const store = new VectorStore(dir);
    await store.save({
      model: 'BAAI/bge-m3',
      provider: '硅基流动',
      builtAt: '2026-08-15T00:00:00Z',
      dim: 3,
      vectors: [{ id: 'a', v: [1, 2, 3] }, { id: 'b', v: [4, 5, 6] }],
    });
    const store2 = new VectorStore(dir);
    const loaded = await store2.load();
    expect(loaded?.vectors.length).toBe(2);
    expect(loaded?.dim).toBe(3);
  });
});

describe('indexCompatibilityIssue', () => {
  const config = { enabled: true, provider: 'p', baseUrl: 'https://example.test/v1', model: 'm', apiKey: 'secret' };
  const entry: CatalogEntry = { id: 'a', title: 'A', description: 'B', tags: [], category: 'plugin' };

  it('marks legacy and model-mismatched indexes stale', () => {
    const legacy = { model: 'm', provider: 'p', builtAt: '', dim: 2, vectors: [{ id: 'a', v: [1, 2] }] };
    expect(indexCompatibilityIssue(legacy, config, [entry])).toMatch(/格式/);
    expect(indexCompatibilityIssue({ ...legacy, version: 2, endpoint: 'https://example.test/v1/embeddings', catalogHash: 'x', model: 'other' }, config, [entry])).toMatch(/模型/);
  });

  it('marks an otherwise valid index stale when the cloud catalog changes', () => {
    const valid = {
      version: 2 as const,
      model: 'm', provider: 'p', builtAt: '', dim: 2,
      endpoint: 'https://example.test/v1/embeddings',
      catalogHash: catalogHash([entry]),
      vectors: [{ id: 'a', v: [1, 2] }],
    };
    expect(indexCompatibilityIssue(valid, config, [entry])).toBeUndefined();
    expect(indexCompatibilityIssue(valid, config, [entry, { ...entry, id: 'new/repo' }])).toMatch(/目录已变化/);
  });
});
