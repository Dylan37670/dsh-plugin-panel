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
import type { CatalogEntry, CatalogLens, CatalogSnapshot } from './types.ts';
export declare const DEFAULT_FULL_CATALOG_URL = "https://raw.githubusercontent.com/Dylan37670/dsh-plugin-panel/catalog-data/catalog.json";
interface CommunityRegistryEntry {
    name?: string;
    owner?: string;
    url?: string;
    category?: string;
    description?: {
        en?: string;
        zh?: string;
    };
    npm?: string | null;
    install?: string;
    stars?: number;
}
/** Accept only the official dsh-plugin command shape; never execute arbitrary registry text. */
export declare function installSpecFromCommand(command: string | undefined): string | undefined;
/** Convert the community-maintained install registry into panel entries. */
export declare function parseCommunityRegistry(file: {
    plugins?: CommunityRegistryEntry[];
}): CatalogEntry[];
/** Parse the awesome-dsh-plugin README bullet list into entries. */
export declare function parseAwesomeMarkdown(markdown: string): CatalogEntry[];
/** Merge fetched entries with the curated seed (seed wins for curated fields). */
export declare function mergeWithSeed(fetched: CatalogEntry[]): CatalogEntry[];
/** Guess a category for a GitHub topic-search repo from name/description. */
export declare function guessCategory(name: string, description: string): CatalogEntry['category'];
/** GitHub topic search result item (the fields we consume). */
interface GitHubRepo {
    full_name: string;
    name: string;
    description: string | null;
    html_url: string;
    stargazers_count?: number;
    language?: string | null;
    owner?: {
        login?: string;
    };
    created_at?: string;
}
/** One created-date search bucket (inclusive, YYYY-MM-DD). */
export interface DateBucket {
    start: string;
    end: string;
}
/** Split a date bucket at its midpoint into two disjoint halves. */
export declare function splitDateBucket(bucket: DateBucket): [DateBucket, DateBucket];
/** Initial coarse created-date buckets for the topic (year + current-year halves). */
export declare function initialDateBuckets(now?: Date): DateBucket[];
/**
 * Build one GitHub search query URL for a bucket.
 *
 * Sorted by `created` (desc), NOT by stars: thousands of topic repos share
 * low star counts, and star-sorted pagination is unstable across pages with
 * ties (items get skipped). `created` is effectively unique per repo, giving
 * stable pagination; the merged result is re-sorted by stars afterwards.
 */
export declare function bucketSearchUrl(bucket: DateBucket, page: number): string;
/** Fetch one page of one bucket, handling the unauthenticated rate limit once. */
export declare function githubSearchPage(url: string, signal?: AbortSignal): Promise<{
    items: GitHubRepo[];
    total: number;
}>;
/** Fetch repos tagged with a GitHub topic, best-effort up to 1000 (API cap). */
export declare function fetchGitHubTopic(topic: string, signal?: AbortSignal): Promise<{
    entries: CatalogEntry[];
    totalHits: number;
}>;
/**
 * Fetch EVERY repo tagged with the topic by splitting the created-date range
 * into buckets that stay under the API's 1000-result cap, paging each bucket,
 * and pacing requests to respect the unauthenticated search rate limit
 * (10/min). Merged by repo, globally sorted by stars.
 *
 * Runtime is typically 1鈥? minutes depending on how many buckets are needed.
 */
export declare function fetchGitHubTopicFull(topic: string, signal?: AbortSignal, opts?: {
    paceMs?: number;
    maxQueries?: number;
}): Promise<{
    entries: CatalogEntry[];
    totalHits: number;
    queries: number;
    complete: boolean;
    gaps: number;
}>;
/**
 * Catalog service bound to one plugin context. Keeps two lens caches:
 *  - curated: the awesome-dsh-plugin list (or a remote JSON URL)
 *  - all:     GitHub topic search over `dsh-plugin`
 */
export declare class CatalogService {
    readonly dir: string;
    private readonly cacheFile;
    private cached;
    private bundledAll;
    private bundledCurated;
    private starsMap;
    constructor(dshHome: string);
    /** repo base URL → stars, built from the bundled full index (v5.4). */
    private starsByRepo;
    /** Attach real GitHub stars to entries that lack them (curated lens). */
    enrichStars(entries: CatalogEntry[]): Promise<CatalogEntry[]>;
    /** Path of the prebuilt full-repo index shipped with the package. */
    bundledAllPath(): string;
    /** Path of the prebuilt curated index shipped with the package (v6.12). */
    bundledCuratedPath(): string;
    /** Load the prebuilt curated index bundled with the plugin (v6.12). */
    readBundledCurated(): Promise<CatalogSnapshot | undefined>;
    /** Load the prebuilt full-repo index bundled with the plugin. */
    readBundledAll(): Promise<CatalogSnapshot | undefined>;
    private readCache;
    private writeCache;
    /** Age of the on-disk cache in ms (Infinity when absent). */
    cacheAgeMs(lens: CatalogLens): Promise<number>;
    /**
     * Current snapshot for a lens. Priority for the `all` lens (v5.1):
     *  1. a cache that is an explicit FULL prebuilt download (partial === false);
     *  2. the prebuilt bundled index (complete, ships with the plugin) — beats
     *     any cache without that marker, including legacy caches written before
     *     the `partial` flag existed (old fast top-1000 crawls);
     *  3. any remaining cache, then the seed.
     */
    snapshot(lens?: CatalogLens): Promise<CatalogSnapshot>;
    /** Fetch the curated remote source (default awesome README). */
    fetchCurated(remoteUrl: string, signal?: AbortSignal): Promise<CatalogSnapshot>;
    /**
     * Download a prebuilt full-repo catalog.json from a remote URL (v3 refresh
     * path: one fast single-file download instead of crawling GitHub pages).
     */
    fetchPrebuiltAll(remoteUrl: string, signal?: AbortSignal): Promise<CatalogSnapshot>;
    /**
     * Download a prebuilt curated index (catalog/curated.json) from a remote URL
     * (v6.12 refresh path — one fast single-file download).
     */
    fetchPrebuiltCurated(remoteUrl: string, signal?: AbortSignal): Promise<CatalogSnapshot>;
    /** Invalidate one lens's in-memory cache (used after a failed refresh). */
    invalidate(lens: CatalogLens): void;
}
export {};
