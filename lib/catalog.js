/**
 * Catalog service: merges the curated seed with a live community source, caches
 * the result to disk, and answers snapshots over the panel's HTTP routes.
 *
 * Live sources (in order of preference):
 *  1. `remoteCatalogUrl` 鈥?a JSON catalog file `{ entries: CatalogEntry[] }`
 *     (a published catalog anyone can host).
 *  2. The awesome-dsh-plugin README (default) 鈥?parsed with a small markdown
 *     regex over its `- [name](url) - description` bullet format.
 *
 * Every fetch result is merged with the seed so curated Chinese translations,
 * categories and install specs survive even when a live source omits them.
 */
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_ENTRIES, SEED_BY_REPO } from "./catalog-data.js";
const DEFAULT_AWESOME_URL = 'https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/README.md';
/** Normalize a repo URL to its base (strip #fragment). */
function baseRepo(url) {
    return url.split('#')[0].replace(/\/$/, '');
}
/** Map an awesome-list section header to our categories. */
function categoryFromSection(section) {
    const s = section.toLowerCase();
    if (s.includes('skill'))
        return 'skill';
    if (s.includes('theme') || s.includes('ui enhance'))
        return 'client';
    if (s.includes('market') || s.includes('manager') || s.includes('badge'))
        return 'dev-resource';
    return 'plugin';
}
/** Parse the awesome-dsh-plugin README bullet list into entries. */
export function parseAwesomeMarkdown(markdown) {
    const entries = [];
    let section = '';
    const seen = new Set();
    for (const rawLine of markdown.split(/\r?\n/)) {
        const line = rawLine.trim();
        const header = line.match(/^### (.+)$/);
        if (header) {
            section = header[1];
            continue;
        }
        const bullet = line.match(/^- \[([^\]]+)\]\(([^)]+)\) - (.+)$/);
        if (!bullet)
            continue;
        const [, name, url, description] = bullet;
        const repo = baseRepo(url);
        if (!/^https:\/\/github\.com\//.test(repo) || seen.has(repo))
            continue;
        seen.add(repo);
        const seed = SEED_BY_REPO.get(repo);
        entries.push({
            id: repo.replace(/^https:\/\/github\.com\//, ''),
            title: seed?.title ?? name,
            ...(seed?.titleZh ? { titleZh: seed.titleZh } : {}),
            description: seed?.description ?? description.trim(),
            ...(seed?.descriptionZh ? { descriptionZh: seed.descriptionZh } : {}),
            category: seed?.category ?? categoryFromSection(section),
            repo,
            ...(seed?.npm ? { npm: seed.npm } : {}),
            install: seed?.install ?? `github:${repo.replace(/^https:\/\/github\.com\//, '')}`,
            tags: seed?.tags ?? [name.toLowerCase()],
            ...(seed?.author ? { author: seed.author } : {}),
        });
    }
    return entries;
}
/** Merge fetched entries with the curated seed (seed wins for curated fields). */
export function mergeWithSeed(fetched) {
    const merged = new Map();
    for (const seed of SEED_ENTRIES) {
        const key = seed.repo ? baseRepo(seed.repo) : seed.id;
        if (!merged.has(key))
            merged.set(key, seed);
    }
    for (const fetchedEntry of fetched) {
        const key = fetchedEntry.repo ? baseRepo(fetchedEntry.repo) : fetchedEntry.id;
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, fetchedEntry);
            continue;
        }
        merged.set(key, {
            ...fetchedEntry,
            ...existing,
            tags: [...new Set([...(existing.tags ?? []), ...(fetchedEntry.tags ?? [])])],
        });
    }
    return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title));
}
/** Guess a category for a GitHub topic-search repo from name/description. */
export function guessCategory(name, description) {
    const hay = `${name} ${description ?? ''}`.toLowerCase();
    if (/skill/.test(hay))
        return 'skill';
    if (/theme|skin|wallpaper|mobile|sidebar|composer|ui\b|interface/.test(hay))
        return 'client';
    if (/docs?|template|collection|toolkit|awesome|starter|example|hub/.test(hay))
        return 'dev-resource';
    return 'plugin';
}
const GITHUB_SEARCH_HEADERS = {
    'User-Agent': 'dsh-plugin-panel',
    Accept: 'application/vnd.github+json',
};
const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (githubToken)
    GITHUB_SEARCH_HEADERS.Authorization = `Bearer ${githubToken}`;
/** Split a date bucket at its midpoint into two disjoint halves. */
export function splitDateBucket(bucket) {
    const start = new Date(`${bucket.start}T00:00:00Z`).getTime();
    const end = new Date(`${bucket.end}T00:00:00Z`).getTime();
    const mid = start + Math.floor((end - start) / 2);
    const midDate = new Date(mid).toISOString().slice(0, 10);
    const nextStart = new Date(mid + 86_400_000).toISOString().slice(0, 10);
    return [
        { start: bucket.start, end: midDate },
        { start: nextStart, end: bucket.end },
    ];
}
/** Initial coarse created-date buckets for the topic (year + current-year halves). */
export function initialDateBuckets(now = new Date()) {
    const year = now.getFullYear();
    const buckets = [{ start: '2008-01-01', end: '2023-12-31' }];
    for (let y = 2024; y < year; y += 1)
        buckets.push({ start: `${y}-01-01`, end: `${y}-12-31` });
    buckets.push({ start: `${year}-01-01`, end: `${year}-06-30` });
    buckets.push({ start: `${year}-07-01`, end: `${year}-12-31` });
    return buckets;
}
/**
 * Build one GitHub search query URL for a bucket.
 *
 * Sorted by `created` (desc), NOT by stars: thousands of topic repos share
 * low star counts, and star-sorted pagination is unstable across pages with
 * ties (items get skipped). `created` is effectively unique per repo, giving
 * stable pagination; the merged result is re-sorted by stars afterwards.
 */
export function bucketSearchUrl(bucket, page) {
    return `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:dsh-plugin created:${bucket.start}..${bucket.end}`)}&sort=created&order=desc&per_page=100&page=${page}`;
}
function toEntry(repo, topic) {
    return {
        id: repo.full_name,
        title: repo.name,
        description: repo.description ?? '(no description)',
        category: guessCategory(repo.name, repo.description ?? ''),
        repo: repo.html_url,
        install: `github:${repo.full_name}`,
        tags: [repo.language ?? 'dsh', topic],
        author: repo.owner?.login,
        stars: repo.stargazers_count ?? 0,
    };
}
/** Fetch one page of one bucket, handling the unauthenticated rate limit once. */
export async function githubSearchPage(url, signal) {
    const request = async () => {
        const response = await fetch(url, { signal, headers: GITHUB_SEARCH_HEADERS });
        if (response.status === 403) {
            // Search rate limit (10/min unauthenticated): back off and retry once.
            await new Promise((resolve) => setTimeout(resolve, 60_000));
            const retry = await fetch(url, { signal, headers: GITHUB_SEARCH_HEADERS });
            if (retry.status === 403)
                throw new Error('github search rate limit exceeded');
            return retry;
        }
        return response;
    };
    const response = await request();
    if (!response.ok)
        throw new Error(`github topic search failed: HTTP ${response.status}`);
    const body = (await response.json());
    return { items: body.items ?? [], total: body.total_count ?? 0 };
}
/** Fetch repos tagged with a GitHub topic, best-effort up to 1000 (API cap). */
export async function fetchGitHubTopic(topic, signal) {
    const entries = [];
    let totalHits = 0;
    for (let page = 1; page <= 10; page += 1) {
        const response = await fetch(bucketSearchUrl({ start: '2000-01-01', end: '2099-12-31' }, page), {
            signal,
            headers: GITHUB_SEARCH_HEADERS,
        });
        if (response.status === 403)
            break; // search rate limit 鈥?return what we have
        if (!response.ok)
            throw new Error(`github topic search failed: HTTP ${response.status}`);
        const body = (await response.json());
        totalHits = body.total_count ?? totalHits;
        const items = body.items ?? [];
        for (const repo of items)
            entries.push(toEntry(repo, topic));
        if (items.length < 100)
            break;
    }
    return { entries, totalHits };
}
/**
 * Fetch EVERY repo tagged with the topic by splitting the created-date range
 * into buckets that stay under the API's 1000-result cap, paging each bucket,
 * and pacing requests to respect the unauthenticated search rate limit
 * (10/min). Merged by repo, globally sorted by stars.
 *
 * Runtime is typically 1鈥? minutes depending on how many buckets are needed.
 */
export async function fetchGitHubTopicFull(topic, signal, opts = {}) {
    const paceMs = opts.paceMs ?? (githubToken ? 2_000 : 7_000);
    const maxQueries = opts.maxQueries ?? 85;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // Exact grand total (one request).
    const countPage = await githubSearchPage(`https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:${topic}`)}&per_page=1`, signal);
    const totalHits = countPage.total;
    let queries = 1;
    const seen = new Map();
    const queue = initialDateBuckets().map((bucket) => `created:${bucket.start}..${bucket.end}`);
    const gaps = [];
    const fragmentUrl = (fragment, page) => `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:${topic} ${fragment}`)}&sort=created&order=desc&per_page=100&page=${page}`;
    const childrenOf = (fragment) => {
        const created = fragment.match(/created:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/);
        if (!created)
            return [];
        const [, start, end] = created;
        const rest = fragment.replace(created[0], '').trim();
        if (start !== end) {
            const [a, b] = splitDateBucket({ start, end });
            return [
                `created:${a.start}..${a.end}${rest ? ` ${rest}` : ''}`,
                `created:${b.start}..${b.end}${rest ? ` ${rest}` : ''}`,
            ];
        }
        const stars = fragment.match(/stars:(\d+)\.\.(\d+)/);
        if (!stars) {
            return ['0..0', '1..2', '3..5', '6..10', '11..25', '26..50', '51..100', '101..500', '501..100000']
                .map((range) => `created:${start}..${end} stars:${range}`);
        }
        const starLo = Number(stars[1]);
        const starHi = Number(stars[2]);
        const withoutStars = rest.replace(stars[0], '').trim();
        if (starHi > starLo) {
            const mid = Math.floor((starLo + starHi) / 2);
            return [
                `created:${start}..${end} stars:${starLo}..${mid}${withoutStars ? ` ${withoutStars}` : ''}`,
                `created:${start}..${end} stars:${mid + 1}..${starHi}${withoutStars ? ` ${withoutStars}` : ''}`,
            ];
        }
        const size = fragment.match(/size:(\d+)\.\.(\d+)/);
        if (!size) {
            return ['0..100', '101..1000', '1001..100000000']
                .map((range) => `created:${start}..${end} ${stars[0]} size:${range}`);
        }
        const sizeLo = Number(size[1]);
        const sizeHi = Number(size[2]);
        if (sizeHi <= sizeLo)
            return [];
        const mid = Math.floor((sizeLo + sizeHi) / 2);
        return [
            `created:${start}..${end} ${stars[0]} size:${sizeLo}..${mid}`,
            `created:${start}..${end} ${stars[0]} size:${mid + 1}..${sizeHi}`,
        ];
    };
    const drainFragment = async (fragment) => {
        const collected = [];
        for (let page = 1; page <= 10; page += 1) {
            if (queries >= maxQueries)
                return;
            if (queries > 1)
                await sleep(paceMs);
            queries += 1;
            const { items, total } = await githubSearchPage(fragmentUrl(fragment, page), signal);
            collected.push(...items);
            if (items.length < 100)
                break;
            if (page === 1 && total > 1000) {
                const children = childrenOf(fragment);
                if (children.length > 0)
                    queue.push(...children);
                else
                    gaps.push({ fragment, total });
                break;
            }
        }
        for (const repo of collected) {
            if (!seen.has(repo.full_name))
                seen.set(repo.full_name, toEntry(repo, topic));
        }
    };
    while (queue.length > 0 && queries < maxQueries) {
        const fragment = queue.shift();
        if (fragment === undefined)
            break;
        await drainFragment(fragment);
    }
    const entries = [...seen.values()].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
    return { entries, totalHits, queries, complete: queue.length === 0 && gaps.length === 0, gaps: gaps.length };
}
/**
 * Catalog service bound to one plugin context. Keeps two lens caches:
 *  - curated: the awesome-dsh-plugin list (or a remote JSON URL)
 *  - all:     GitHub topic search over `dsh-plugin`
 */
export class CatalogService {
    dir;
    cacheFile;
    cached = new Map();
    bundledAll;
    starsMap;
    constructor(dshHome) {
        this.dir = join(dshHome, 'plugin-panel');
        this.cacheFile = (lens) => join(this.dir, lens === 'all' ? 'catalog.all.cache.json' : 'catalog.cache.json');
    }
    /** repo base URL → stars, built from the bundled full index (v5.4). */
    async starsByRepo() {
        if (this.starsMap)
            return this.starsMap;
        const map = new Map();
        const bundled = await this.readBundledAll();
        if (bundled) {
            for (const entry of bundled.entries) {
                if (entry.repo && typeof entry.stars === 'number' && entry.stars > 0) {
                    map.set(entry.repo.split('#')[0].replace(/\/$/, ''), entry.stars);
                }
            }
        }
        this.starsMap = map;
        return map;
    }
    /** Attach real GitHub stars to entries that lack them (curated lens). */
    async enrichStars(entries) {
        const map = await this.starsByRepo();
        return entries.map((entry) => {
            if (typeof entry.stars === 'number' && entry.stars > 0)
                return entry;
            if (!entry.repo)
                return entry;
            const stars = map.get(entry.repo.split('#')[0].replace(/\/$/, ''));
            return stars !== undefined ? { ...entry, stars } : entry;
        });
    }
    /** Path of the prebuilt full-repo index shipped with the package. */
    bundledAllPath() {
        return fileURLToPath(new URL('../catalog/catalog.json', import.meta.url));
    }
    /** Load the prebuilt full-repo index bundled with the plugin. */
    async readBundledAll() {
        if (this.bundledAll)
            return this.bundledAll;
        try {
            const raw = await readFile(this.bundledAllPath(), 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.entries) && parsed.entries.length > 0) {
                const snapshot = {
                    entries: parsed.entries,
                    fetchedAt: parsed.manifest?.generatedAt,
                    source: 'remote',
                    lens: 'all',
                    totalHits: parsed.manifest?.totalHits ?? parsed.entries.length,
                };
                this.bundledAll = snapshot;
                return snapshot;
            }
        }
        catch {
            /* bundled index absent — fall back to live fetch */
        }
        return undefined;
    }
    async readCache(lens) {
        const hit = this.cached.get(lens);
        if (hit)
            return hit;
        try {
            const raw = await readFile(this.cacheFile(lens), 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.entries)) {
                const snapshot = { ...parsed, lens, source: 'cache' };
                this.cached.set(lens, snapshot);
                return snapshot;
            }
        }
        catch {
            /* no cache yet */
        }
        return undefined;
    }
    async writeCache(snapshot) {
        await mkdir(this.dir, { recursive: true });
        const file = this.cacheFile(snapshot.lens);
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
        await rename(tmp, file);
    }
    /** Age of the on-disk cache in ms (Infinity when absent). */
    async cacheAgeMs(lens) {
        try {
            const info = await stat(this.cacheFile(lens));
            return Date.now() - info.mtimeMs;
        }
        catch {
            return Number.POSITIVE_INFINITY;
        }
    }
    /**
     * Current snapshot for a lens. Priority for the `all` lens (v5.1):
     *  1. a cache that is an explicit FULL prebuilt download (partial === false);
     *  2. the prebuilt bundled index (complete, ships with the plugin) — beats
     *     any cache without that marker, including legacy caches written before
     *     the `partial` flag existed (old fast top-1000 crawls);
     *  3. any remaining cache, then the seed.
     */
    async snapshot(lens = 'curated') {
        const cache = await this.readCache(lens);
        if (lens === 'all') {
            if (cache && cache.partial === false)
                return cache;
            const bundled = await this.readBundledAll();
            if (bundled)
                return bundled;
            if (cache)
                return cache;
            return { entries: SEED_ENTRIES, source: 'seed', lens };
        }
        if (cache)
            return { ...cache, entries: await this.enrichStars(cache.entries) };
        return { entries: await this.enrichStars(SEED_ENTRIES), source: 'seed', lens };
    }
    /** Fetch the curated remote source (default awesome README). */
    async fetchCurated(remoteUrl, signal) {
        const url = remoteUrl.trim() || DEFAULT_AWESOME_URL;
        const response = await fetch(url, { signal, headers: { 'User-Agent': 'dsh-plugin-panel' } });
        if (!response.ok)
            throw new Error(`catalog fetch failed: HTTP ${response.status} from ${url}`);
        const text = await response.text();
        let fetched;
        const isJson = url.endsWith('.json') || text.trimStart().startsWith('{');
        if (isJson) {
            const file = JSON.parse(text);
            fetched = file.entries ?? [];
        }
        else {
            fetched = parseAwesomeMarkdown(text);
        }
        if (fetched.length === 0)
            throw new Error('catalog fetch returned no entries');
        const merged = mergeWithSeed(fetched);
        const entries = await this.enrichStars(merged);
        const snapshot = { entries, fetchedAt: new Date().toISOString(), source: 'remote', lens: 'curated' };
        await this.writeCache(snapshot);
        this.cached.set('curated', { ...snapshot, source: 'cache' });
        return snapshot;
    }
    /**
     * Download a prebuilt full-repo catalog.json from a remote URL (v3 refresh
     * path: one fast single-file download instead of crawling GitHub pages).
     */
    async fetchPrebuiltAll(remoteUrl, signal) {
        const url = remoteUrl.trim();
        if (!url)
            throw new Error('未配置远程目录 URL');
        const response = await fetch(url, { signal, headers: { 'User-Agent': 'dsh-plugin-panel' } });
        if (!response.ok)
            throw new Error(`catalog download failed: HTTP ${response.status} from ${url}`);
        const parsed = JSON.parse(await response.text());
        if (!Array.isArray(parsed.entries) || parsed.entries.length === 0)
            throw new Error('远程目录文件没有 entries');
        const merged = mergeWithSeed(parsed.entries);
        const snapshot = {
            entries: merged,
            fetchedAt: parsed.manifest?.generatedAt ?? new Date().toISOString(),
            source: 'remote',
            lens: 'all',
            totalHits: parsed.manifest?.totalHits ?? merged.length,
            partial: false,
        };
        await this.writeCache(snapshot);
        this.cached.set('all', { ...snapshot, source: 'cache' });
        return snapshot;
    }
    /** Fetch the full-repo lens from the GitHub topic search (fast, top 1000). */
    async fetchAll(signal) {
        const { entries, totalHits } = await fetchGitHubTopic('dsh-plugin', signal);
        if (entries.length === 0)
            throw new Error('github topic search returned no repos');
        const merged = mergeWithSeed(entries);
        const snapshot = {
            entries: merged,
            fetchedAt: new Date().toISOString(),
            source: 'remote',
            lens: 'all',
            totalHits,
            partial: true,
        };
        await this.writeCache(snapshot);
        this.cached.set('all', { ...snapshot, source: 'cache' });
        return snapshot;
    }
    /**
     * Fetch EVERY repo for the all lens (adaptive created-date buckets, paced).
     * Used by the offline catalog build script — the panel itself no longer
     * crawls the full topic on every refresh.
     */
    async fetchAllFull(signal, opts) {
        const { entries, totalHits, complete, gaps } = await fetchGitHubTopicFull('dsh-plugin', signal, opts);
        if (entries.length === 0)
            throw new Error('github topic search returned no repos');
        const merged = mergeWithSeed(entries);
        if (!complete) {
            throw new Error(`GitHub 全量抓取未完成（已取得 ${merged.length}/${totalHits}，缺口 ${gaps}）；请稍后重试`);
        }
        const snapshot = {
            entries: merged,
            fetchedAt: new Date().toISOString(),
            source: 'remote',
            lens: 'all',
            totalHits,
            partial: false,
        };
        await this.writeCache(snapshot);
        this.cached.set('all', { ...snapshot, source: 'cache' });
        return snapshot;
    }
    /** Invalidate one lens's in-memory cache (used after a failed refresh). */
    invalidate(lens) {
        this.cached.delete(lens);
    }
}
