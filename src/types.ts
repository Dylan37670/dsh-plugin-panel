/**
 * Shared JSON wire types for the Plugin Panel (host ↔ client).
 *
 * Everything crossing the HTTP boundary must be plain JSON. Keep this module
 * free of Node and Cordis imports so it stays trivially testable and safe to
 * share with the hand-written client bundle.
 */

/** Marketplace category shown in the drawer. */
export type Category = 'plugin' | 'skill' | 'client' | 'dev-resource';

export const CATEGORY_LABELS: Record<Category, string> = {
  plugin: '插件',
  skill: 'Skill',
  client: '客户端',
  'dev-resource': '开发资源',
};

export const CATEGORY_ORDER: Category[] = ['plugin', 'skill', 'client', 'dev-resource'];

/** One catalog entry. */
export interface CatalogEntry {
  /** Stable id (usually the repo slug). */
  id: string;
  /** Display title (prefer English original when known). */
  title: string;
  /** Chinese title when available. */
  titleZh?: string;
  /** English description. */
  description: string;
  /** Chinese description (curated translation). */
  descriptionZh?: string;
  /** Marketplace category. */
  category: Category;
  /** GitHub repository URL when known. */
  repo?: string;
  /** npm package name when published (preferred install spec). */
  npm?: string;
  /** Install spec handed to `dsh plugin add` (npm name, github: spec or URL). */
  install?: string;
  /** True only when the install target came from an author/community manifest. */
  installVerified?: boolean;
  /** Human-readable provenance for the install target. */
  installSource?: 'author' | 'community' | 'bundled';
  /** Search keywords (zh + en). */
  tags: string[];
  /** Author / organization credit. */
  author?: string;
  /** Rough GitHub stars (0 when unknown; refresh source may not provide it). */
  stars?: number;
}

/** Snapshot of the catalog list (cache metadata + entries). */
export interface CatalogSnapshot {
  entries: CatalogEntry[];
  /** ISO time the list was last fetched from a remote source. */
  fetchedAt?: string;
  /** Where the list came from: 'seed' | 'cache' | 'remote'. */
  source: 'seed' | 'cache' | 'remote';
  /** Catalog lens this snapshot belongs to. */
  lens: CatalogLens;
  /** Total hits reported by the remote source (GitHub topic search). */
  totalHits?: number;
  /** True when this list is a partial view (e.g. fast top-1000 crawl). */
  partial?: boolean;
  /** ISO time the data branch artifact was generated. */
  generatedAt?: string;
  /** Entries fetched from GitHub topic search before curated supplements. */
  fetchedCount?: number;
  /** Percent of GitHub topic hits represented by fetchedCount. */
  coveragePct?: number;
  /** Number of uncovered search buckets; must be zero for published data. */
  gaps?: number;
  /** HTTP validators used by the data-branch JSON download. */
  etag?: string;
  lastModified?: string;
}

/** One translation request/result item (host LLM on-demand zh). */
export interface TranslationItem {
  id: string;
  title: string;
  description: string;
}

export interface TranslationResult {
  id: string;
  titleZh: string;
  descriptionZh: string;
}

/** Which catalog lens the panel is showing. */
export type CatalogLens = 'curated' | 'all';

/** One installed plugin record (profile bundle or user skill). */
export interface InstalledItem {
  /** Real package name (bundle/dependency) or skill name. */
  name: string;
  kind: 'bundle' | 'skill' | 'dependency';
  profile?: string;
  /** Whether DSH will activate it after restart. */
  enabled: boolean;
  /** Exact dependency key used for update/remove. */
  packageName: string;
  /** Saved dependency spec (npm version, github: spec, URL...). */
  spec?: string;
  /** Human-readable reason for an inactive dependency. */
  issue?: string;
  /** How the package is activated in this profile. */
  activation?: 'bundle' | 'manual' | 'skill' | 'none';
  /** Manual patch row was created by Plugin Panel and may be removed safely. */
  panelManaged?: boolean;
}

/** Embedding (semantic search) configuration (v6). */
export interface EmbeddingConfig {
  enabled: boolean;
  provider: string; // display name, e.g. '硅基流动'
  baseUrl: string; // OpenAI-compatible embeddings endpoint base, e.g. https://api.siliconflow.cn/v1
  model: string; // e.g. BAAI/bge-m3
  apiKey: string;
}

export const DEFAULT_EMBEDDING: EmbeddingConfig = {
  enabled: false,
  provider: '硅基流动',
  baseUrl: 'https://api.siliconflow.cn/v1',
  model: 'BAAI/bge-m3',
  apiKey: '',
};

/** User state (favorites + settings) persisted by the host. */
export interface PanelState {
  favorites: string[];
  settings: {
    /** Target profile for install/update/uninstall commands. */
    profile: string;
    /** Optional remote catalog JSON URL ('' = awesome-dsh-plugin README). */
    remoteCatalogUrl: string;
    /** Language of descriptions the client prefers ('zh' | 'en' | 'auto'). */
    descriptionLang: 'zh' | 'en' | 'auto';
    /** Catalog lens: curated awesome list or full GitHub topic search. */
    catalogSource: CatalogLens;
    /** Sort order applied to the visible list ('default' | 'stars-desc' | …). */
    sort?: string;
    /** Embedding (semantic search) config. */
    embedding?: EmbeddingConfig;
  };
}

export const DEFAULT_STATE: PanelState = {
  favorites: [],
  settings: {
    profile: 'web',
    remoteCatalogUrl: '',
    descriptionLang: 'auto',
    catalogSource: 'curated',
    sort: 'default',
    embedding: DEFAULT_EMBEDDING,
  },
};

/** Result of one lifecycle command (install / update / uninstall). */
export interface LifecycleResult {
  ok: boolean;
  command: string;
  output: string;
  /** Backed-up profile package.json path (empty when none). */
  backupPath?: string;
  /** Set when a failure was rolled back to the backup. */
  rolledBack?: boolean;
  /** Human-readable message (error or success note). */
  message: string;
  /** Exact dependency key discovered after installation. */
  packageName?: string;
  /** True when an update completed but the lockfile did not change. */
  alreadyLatest?: boolean;
  /** Activation mechanism verified after the command. */
  activation?: 'bundle' | 'manual';
}

/** One in-flight / finished operation shown in the drawer. */
export interface OperationView {
  id: string;
  label: string;
  state: 'running' | 'ok' | 'error';
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}
