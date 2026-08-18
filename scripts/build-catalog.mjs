/**
 * Offline catalog build (v3): crawl the full `dsh-plugin` GitHub topic into
 * `catalog/catalog.json` — the prebuilt index the panel loads/downloads.
 *
 * Usage:
 *   node scripts/build-catalog.mjs [--reset] [--max-queries N] [--pace-ms N]
 *
 * - Resumable: progress persists to `catalog/.build-state.json`; re-running
 *   continues where the last run stopped.
 * - Saturation handling (GitHub search caps one query at 1000 results):
 *   1. date range > 1 day  → split the range in half;
 *   2. exactly 1 day still > 1000 → subdivide by `stars:` ranges;
 *   3. a single star value still > 1000 → subdivide by `size:` ranges;
 *   4. irreducible → recorded in `gaps` and reported (never silent).
 * - Pacing: 7s unauthenticated (10 req/min); with `GITHUB_TOKEN`/`GH_TOKEN`
 *   set, pace drops to 2s.
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubSearchPage, initialDateBuckets, splitDateBucket, mergeWithSeed, guessCategory, parseCommunityRegistry, parseAwesomeMarkdown } from '../lib/catalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = join(ROOT, 'catalog');
const STATE_FILE = join(CATALOG_DIR, '.build-state.json');
const OUT_FILE = join(CATALOG_DIR, 'catalog.json');
const CURATED_OUT = join(CATALOG_DIR, 'curated.json');
const TOPIC = 'dsh-plugin';
const CURATED_SOURCE = 'https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/README.md';
const INSTALL_REGISTRY = process.env.INSTALL_REGISTRY_URL
  ?? 'https://raw.githubusercontent.com/dsh-market/dsh-market/main/data/registry-snapshot.json';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const curatedOnly = args.includes('--curated-only');
const maxQueries = Number(args.find((a) => a.startsWith('--max-queries='))?.split('=')[1] ?? 18);
const paceMs = Number(args.find((a) => a.startsWith('--pace-ms='))?.split('=')[1] ?? (process.env.GITHUB_TOKEN || process.env.GH_TOKEN ? 2_000 : 7_000));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build the curated prebuilt index (v6.12): parse the awesome-dsh-plugin
 * README, merge with the curated seed, write catalog/curated.json.
 * Fast (one fetch) — safe to run periodically.
 */
async function buildCurated() {
  const response = await fetch(CURATED_SOURCE, { headers: { 'User-Agent': 'dsh-plugin-panel-catalog' } });
  if (!response.ok) throw new Error(`curated source unavailable (${CURATED_SOURCE}): HTTP ${response.status}`);
  const fetched = parseAwesomeMarkdown(await response.text());
  if (fetched.length === 0) throw new Error('curated parse returned no entries');
  const entries = mergeWithSeed(fetched);
  const manifest = {
    generatedAt: new Date().toISOString(),
    fetchedCount: fetched.length,
    count: entries.length,
    source: 'awesome-dsh-plugin',
    schema: 'plugin-panel-curated@1',
  };
  await mkdir(CATALOG_DIR, { recursive: true });
  const tmp = `${CURATED_OUT}.tmp`;
  await writeFile(tmp, JSON.stringify({ manifest, entries }, null, 2), 'utf8');
  await rm(CURATED_OUT, { force: true }).catch(() => {});
  const { rename } = await import('node:fs/promises');
  await rename(tmp, CURATED_OUT);
  console.log(`[build-catalog] curated done: ${entries.length} entries (fetched ${fetched.length})`);
  return entries;
}

/** Sub-partition ranges for saturated one-day buckets. */
const STAR_RANGES = ['0..0', '1..2', '3..5', '6..10', '11..25', '26..50', '51..100', '101..500', '501..100000'];
const SIZE_RANGES = ['0..100', '101..1000', '1001..100000000'];

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Child query fragments that subdivide a saturated fragment ([] = irreducible). */
function childrenOf(frag) {
  const created = frag.match(/created:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/);
  if (!created) return [];
  const [, start, end] = created;
  const base = frag.replace(created[0], '').trim();

  if (start !== end) {
    // (1) split the date range
    const [a, b] = splitDateBucket({ start, end });
    return [
      `created:${a.start}..${a.end}${base ? ' ' + base : ''}`,
      `created:${b.start}..${b.end}${base ? ' ' + base : ''}`,
    ];
  }

  const stars = frag.match(/stars:(\d+)\.\.(\d+)/);
  if (!stars) {
    // (2) one day, no stars partition yet
    return STAR_RANGES.map((r) => `created:${start}..${end} stars:${r}`);
  }
  const lo = Number(stars[1]);
  const hi = Number(stars[2]);
  const rest = frag.replace(stars[0], '').replace(created[0], '').trim();
  if (hi > lo) {
    // narrow the star range
    const mid = Math.floor((lo + hi) / 2);
    return [
      `created:${start}..${end} stars:${lo}..${mid}${rest ? ' ' + rest : ''}`,
      `created:${start}..${end} stars:${mid + 1}..${hi}${rest ? ' ' + rest : ''}`,
    ];
  }

  const size = frag.match(/size:(\d+)\.\.(\d+)/);
  if (!size) {
    // (3) single star value → subdivide by size
    return SIZE_RANGES.map((r) => `created:${start}..${end} ${stars[0]} size:${r}`);
  }
  const slo = Number(size[1]);
  const shi = Number(size[2]);
  if (shi > slo) {
    const mid = Math.floor((slo + shi) / 2);
    return [
      `created:${start}..${end} ${stars[0]} size:${slo}..${mid}`,
      `created:${start}..${end} ${stars[0]} size:${mid + 1}..${shi}`,
    ];
  }
  return []; // (4) irreducible
}

function searchUrl(frag, page) {
  return `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:${TOPIC} ${frag}`)}&sort=created&order=desc&per_page=100&page=${page}`;
}

/** Fetch one page with retries on transient network errors (TLS resets etc.). */
async function fetchPage(frag, page) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await githubSearchPage(searchUrl(frag, page));
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(12_000); // back off before retrying
    }
  }
  throw lastError;
}

async function loadState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.queue) && parsed.queue.every((q) => typeof q === 'string')) return parsed;
  } catch {
    /* fresh start */
  }
  return {
    done: [],
    queue: initialDateBuckets().map((b) => `created:${b.start}..${b.end}`),
    seen: {},
    gaps: [],
    totalHits: 0,
    queries: 0,
  };
}

async function saveState(state) {
  await mkdir(CATALOG_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state), 'utf8');
}

async function main() {
  // v6.12: the curated index is always (re)built — fast, and the default
  // periodic refresh. The full topic crawl only runs unless --curated-only.
  await buildCurated();
  if (curatedOnly) return;

  if (reset) {
    await rm(STATE_FILE, { force: true }).catch(() => {});
    await rm(OUT_FILE, { force: true }).catch(() => {});
  }
  const state = await loadState();
  const { done, gaps } = state;
  const queue = state.queue;
  const seen = state.seen;
  let { totalHits, queries } = state;
  let runQueries = 0;

  if (totalHits === 0) {
    const countPage = await githubSearchPage(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:${TOPIC}`)}&per_page=1`,
    );
    totalHits = countPage.total;
    queries += 1;
    runQueries += 1;
  }

  const drain = async (frag) => {
    const collected = [];
    for (let page = 1; page <= 10; page += 1) {
      if (runQueries >= maxQueries) return false;
      if (runQueries > 0) await sleep(paceMs);
      runQueries += 1;
      queries += 1;
      const { items, total } = await fetchPage(frag, page);
      collected.push(...items);
      if (items.length < 100) break;
      if (page === 1 && total > 1000) {
        const kids = childrenOf(frag);
        if (kids.length > 0) {
          queue.push(...kids);
          break;
        }
        gaps.push({ frag, total }); // irreducible — surface the gap
      }
    }
    for (const repo of collected) {
      if (!seen[repo.full_name]) {
        seen[repo.full_name] = {
          id: repo.full_name,
          title: repo.name,
          description: repo.description ?? '(no description)',
          category: guessCategory(repo.name, repo.description ?? ''),
          repo: repo.html_url,
          install: `github:${repo.full_name}`,
          tags: [repo.language ?? 'dsh', TOPIC],
          author: repo.owner?.login,
          stars: repo.stargazers_count ?? 0,
          ...(repo.created_at ? { createdAt: repo.created_at } : {}),
        };
      }
    }
    done.push(frag);
    return true;
  };

  while (queue.length > 0 && runQueries < maxQueries) {
    const frag = queue.shift();
    if (!frag) break;
    const completed = await drain(frag);
    if (!completed) {
      queue.unshift(frag);
      break;
    }
    await saveState({ done, queue, seen, gaps, totalHits, queries });
  }

  if (queue.length === 0) {
    const entries = Object.values(seen).sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
    // Topic search discovers repositories, but cannot tell whether the root
    // is installable. Overlay exact author/community install targets (npm or
    // GitHub subpath) and leave every other candidate explicitly unverified.
    let installEntries = [];
    try {
      const response = await fetch(INSTALL_REGISTRY, { headers: { 'User-Agent': 'dsh-plugin-panel-catalog' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      installEntries = parseCommunityRegistry(await response.json());
    } catch (error) {
      throw new Error(`install registry unavailable (${INSTALL_REGISTRY}): ${error instanceof Error ? error.message : String(error)}`);
    }
    const byRoot = new Map();
    for (const candidate of installEntries) {
      const match = candidate.repo?.match(/^https:\/\/github\.com\/([^/]+\/[^/#]+)/i);
      if (!match || !candidate.installVerified) continue;
      const root = match[1].toLowerCase();
      const repoName = root.split('/')[1];
      const score = (candidate.repo?.toLowerCase() === `https://github.com/${root}` ? 100 : 0)
        + (candidate.npm ? 50 : 0)
        + (candidate.title.toLowerCase() === repoName ? 30 : 0)
        + (candidate.title.toLowerCase().endsWith('-all') ? 25 : 0);
      const previous = byRoot.get(root);
      if (!previous || score > previous.score) byRoot.set(root, { score, candidate });
    }
    for (const item of entries) {
      const exact = byRoot.get(item.id.toLowerCase())?.candidate;
      if (!exact) {
        delete item.installVerified;
        delete item.installSource;
        continue;
      }
      item.install = exact.install;
      item.installVerified = true;
      item.installSource = 'community';
      if (exact.npm) item.npm = exact.npm;
      if (exact.descriptionZh) item.descriptionZh = exact.descriptionZh;
    }
    const merged = mergeWithSeed(entries);
    const manifest = {
      generatedAt: new Date().toISOString(),
      totalHits,
      fetchedCount: entries.length,
      count: merged.length,
      coveragePct: totalHits > 0 ? Math.min(100, Number(((entries.length / totalHits) * 100).toFixed(3))) : 100,
      gaps: gaps.length,
      source: `github topic:${TOPIC}`,
      schema: 'plugin-panel-catalog@1',
      installVerifiedCount: merged.filter((entry) => entry.installVerified).length,
      installRegistry: INSTALL_REGISTRY,
    };
    await mkdir(CATALOG_DIR, { recursive: true });
    const tmp = `${OUT_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify({ manifest, entries: merged }, null, 2), 'utf8');
    await rm(OUT_FILE, { force: true }).catch(() => {});
    const { rename } = await import('node:fs/promises');
    await rename(tmp, OUT_FILE);
    await rm(STATE_FILE, { force: true }).catch(() => {});
    console.log(`[build-catalog] done: ${merged.length} entries / ${totalHits} (${manifest.coveragePct}%), gaps ${gaps.length}, queries ${queries}`);
  } else {
    await saveState({ done, queue, seen, gaps, totalHits, queries });
    console.log(`[build-catalog] resumed: ${Object.keys(seen).length} seen, ${queue.length} frags queued, gaps ${gaps.length}, queries ${queries} — rerun to continue`);
  }
}

main().catch((error) => {
  console.error('[build-catalog] failed:', error);
  process.exitCode = 1;
});
