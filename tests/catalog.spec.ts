import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAwesomeMarkdown, mergeWithSeed, guessCategory, CatalogService, splitDateBucket, initialDateBuckets, bucketSearchUrl, fetchGitHubTopicFull } from '../src/catalog.ts';
import { SEED_ENTRIES } from '../src/catalog-data.ts';

const SAMPLE = `# Dummy
## Plugins
### UI Enhancements
- [acme/dsh-foo](https://github.com/acme/dsh-foo) - A foo plugin for the Web UI.
### Tools & Capabilities
- [acme/dsh-bar](https://github.com/acme/dsh-bar) - Bar plugin for tools.
### Skills
- [acme/dsh-skill-baz](https://github.com/acme/dsh-skill-baz) - A baz skill pack.
`;

describe('parseAwesomeMarkdown', () => {
  it('parses bullets with section mapping', () => {
    const entries = parseAwesomeMarkdown(SAMPLE);
    expect(entries.length).toBe(3);
    const foo = entries.find((e) => e.id === 'acme/dsh-foo');
    expect(foo).toBeDefined();
    expect(foo!.category).toBe('client'); // UI Enhancements → client
    expect(foo!.description).toBe('A foo plugin for the Web UI.');
    expect(foo!.install).toBe('github:acme/dsh-foo');
    const bar = entries.find((e) => e.id === 'acme/dsh-bar');
    expect(bar!.category).toBe('plugin');
    const baz = entries.find((e) => e.id === 'acme/dsh-skill-baz');
    expect(baz!.category).toBe('skill');
  });

  it('deduplicates repeated repo URLs', () => {
    const dup = `${SAMPLE}\n- [acme/dsh-foo](https://github.com/acme/dsh-foo) - duplicate`;
    expect(parseAwesomeMarkdown(dup).length).toBe(3);
  });

  it('ignores non-github and malformed lines', () => {
    const messy = `- [x](https://example.com/x) - not github\nplain line\n- [ok](https://github.com/ok/x) - fine`;
    const entries = parseAwesomeMarkdown(messy);
    expect(entries.length).toBe(1);
    expect(entries[0].id).toBe('ok/x');
  });
});

describe('mergeWithSeed', () => {
  it('keeps curated zh translations and categories over fetched data', () => {
    const fetched = [
      { id: 'omdsh-dev/dsh-toolkit', title: 'dsh-toolkit', description: 'raw fetched description', category: 'plugin', repo: 'https://github.com/omdsh-dev/dsh-toolkit', tags: [] },
    ];
    const merged = mergeWithSeed(fetched);
    const tk = merged.find((e) => e.repo === 'https://github.com/omdsh-dev/dsh-toolkit');
    expect(tk).toBeDefined();
    expect(tk!.descriptionZh).toBeTruthy(); // curated zh survives
    expect(tk!.install).toBe('github:omdsh-dev/dsh-toolkit');
  });

  it('includes the seed entries themselves', () => {
    const merged = mergeWithSeed([]);
    expect(merged.length).toBeGreaterThanOrEqual(SEED_ENTRIES.length);
  });
});

describe('guessCategory', () => {
  it('classifies topic-search repos by keywords', () => {
    expect(guessCategory('dsh-skill-pack', 'A skill pack')).toBe('skill');
    expect(guessCategory('dsh-theme', 'A theme skin for the UI')).toBe('client');
    expect(guessCategory('dsh-docs', 'Documentation and templates')).toBe('dev-resource');
    expect(guessCategory('dsh-tool-abc', 'A deterministic tool')).toBe('plugin');
  });
});

describe('date bucket planning (full-repo fetch)', () => {
  it('splits a date range into two disjoint halves', () => {
    const [a, b] = splitDateBucket({ start: '2026-07-01', end: '2026-12-31' });
    expect(a.start).toBe('2026-07-01');
    expect(a.end <= b.start).toBe(true);
    // Re-splitting halves must make progress toward one-day buckets.
    const [a1] = splitDateBucket(a);
    expect(a1.end < a.end).toBe(true);
  });

  it('builds coarse initial buckets ending in the current year halves', () => {
    const buckets = initialDateBuckets(new Date('2026-08-15T00:00:00Z'));
    const years = buckets.map((b) => b.start.slice(0, 4));
    expect(years).toContain('2024');
    expect(years).toContain('2025');
    expect(buckets.at(-2)!.start).toBe('2026-01-01');
    expect(buckets.at(-1)!.start).toBe('2026-07-01');
  });

  it('builds a search URL scoped to the bucket', () => {
    const url = bucketSearchUrl({ start: '2026-08-01', end: '2026-08-31' }, 2);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('created:2026-08-01..2026-08-31');
    expect(decoded).toContain('page=2');
  });
});

describe('fetchGitHubTopicFull (mock API, no network)', () => {
  interface FakeRepo { full_name: string; created: string; stars: number; size?: number; description: string }

  function makeMockGitHub(repos: FakeRepo[]) {
    return async (url: string | URL): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
      const u = new URL(String(url));
      const q = u.searchParams.get('q') ?? '';
      const page = Number(u.searchParams.get('page') ?? '1');
      const range = q.match(/created:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/);
      let pool = repos;
      if (range) {
        const start = Date.parse(range[1]);
        const end = Date.parse(range[2]);
        pool = repos.filter((r) => {
          const t = Date.parse(r.created);
          return t >= start && t <= end;
        });
      }
      const stars = q.match(/stars:(\d+)\.\.(\d+)/);
      if (stars) pool = pool.filter((r) => r.stars >= Number(stars[1]) && r.stars <= Number(stars[2]));
      const size = q.match(/size:(\d+)\.\.(\d+)/);
      if (size) pool = pool.filter((r) => (r.size ?? 0) >= Number(size[1]) && (r.size ?? 0) <= Number(size[2]));
      const sorted = [...pool].sort((a, b) => b.stars - a.stars);
      const items = sorted.slice((page - 1) * 100, page * 100).map((r) => ({
        full_name: r.full_name,
        name: r.full_name.split('/')[1],
        description: r.description,
        html_url: `https://github.com/${r.full_name}`,
        stargazers_count: r.stars,
        language: 'TypeScript',
        owner: { login: r.full_name.split('/')[0] },
      }));
      return {
        ok: true,
        status: 200,
        json: async () => ({ total_count: pool.length, items }),
      };
    };
  }

  it('collects every repo across saturated date buckets, deduped and star-sorted', async () => {
    // 2500 repos concentrated in Jul–Sep 2026 (saturates the H2 bucket).
    const repos: FakeRepo[] = [];
    for (let i = 0; i < 2500; i += 1) {
      const day = 1 + (i % 28);
      const month = 7 + Math.floor(i / 700) % 3; // 7..9
      repos.push({
        full_name: `owner/repo-${String(i).padStart(4, '0')}`,
        created: `2026-0${month}-${String(day).padStart(2, '0')}`,
        stars: 2500 - i,
        description: `repo ${i}`,
      });
    }
    const original = globalThis.fetch;
    globalThis.fetch = makeMockGitHub(repos) as unknown as typeof fetch;
    try {
      const { entries, totalHits, queries, complete, gaps } = await fetchGitHubTopicFull('dsh-plugin', undefined, { paceMs: 0, maxQueries: 200 });
      expect(totalHits).toBe(2500);
      expect(entries.length).toBe(2500); // nothing lost to saturation
      const unique = new Set(entries.map((e) => e.id)).size;
      expect(unique).toBe(2500); // no duplicates
      for (let i = 1; i < entries.length; i += 1) {
        expect(entries[i - 1].stars! >= entries[i].stars!).toBe(true); // star-sorted
      }
      // ~25 pages + count; the early-split keeps query count near the ideal.
      expect(queries).toBeLessThanOrEqual(60);
      expect(complete).toBe(true);
      expect(gaps).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('subdivides a single saturated day by stars and repository size', async () => {
    const repos: FakeRepo[] = Array.from({ length: 1205 }, (_, i) => ({
      full_name: `same-day/repo-${i}`,
      created: '2026-08-15',
      stars: 0,
      size: i,
      description: `same-day ${i}`,
    }));
    const original = globalThis.fetch;
    globalThis.fetch = makeMockGitHub(repos) as unknown as typeof fetch;
    try {
      const result = await fetchGitHubTopicFull('dsh-plugin', undefined, { paceMs: 0, maxQueries: 200 });
      expect(result.complete).toBe(true);
      expect(result.gaps).toBe(0);
      expect(result.entries).toHaveLength(1205);
      expect(new Set(result.entries.map((entry) => entry.id)).size).toBe(1205);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('reports an incomplete crawl when the query budget is exhausted', async () => {
    const repos: FakeRepo[] = Array.from({ length: 1500 }, (_, i) => ({
      full_name: `limited/repo-${i}`,
      created: `2026-08-${String(1 + (i % 15)).padStart(2, '0')}`,
      stars: i,
      description: `limited ${i}`,
    }));
    const original = globalThis.fetch;
    globalThis.fetch = makeMockGitHub(repos) as unknown as typeof fetch;
    try {
      const result = await fetchGitHubTopicFull('dsh-plugin', undefined, { paceMs: 0, maxQueries: 2 });
      expect(result.complete).toBe(false);
      expect(result.entries.length).toBeLessThan(result.totalHits);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('handles an empty topic gracefully', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = makeMockGitHub([]) as unknown as typeof fetch;
    try {
      const { entries, totalHits } = await fetchGitHubTopicFull('dsh-plugin', undefined, { paceMs: 0 });
      expect(totalHits).toBe(0);
      expect(entries.length).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('CatalogService lenses', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-cat2-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps curated cache lens-tagged and separate from the seed', async () => {
    const svc = new CatalogService(dir);
    const curated = await svc.fetchCurated(
      'data:application/json,' + encodeURIComponent(JSON.stringify({ entries: [
        { id: 'c/one', title: 'C1', description: 'd', category: 'plugin', tags: [] },
      ] })),
    );
    expect(curated.lens).toBe('curated');
    const snap = await svc.snapshot('curated');
    expect(snap.source).toBe('cache');
    expect(snap.entries.find((e) => e.id === 'c/one')).toBeTruthy();
    expect(snap.lens).toBe('curated');
    // The all-lens cache file must not exist yet.
    const { stat } = await import('node:fs/promises');
    await expect(stat(join(dir, 'plugin-panel', 'catalog.all.cache.json'))).rejects.toThrow();
  });
});
