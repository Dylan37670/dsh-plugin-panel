/**
 * Semantic search (v6): embed the catalog with an OpenAI-compatible embeddings
 * provider (default: SiliconFlow BAAI/bge-m3, multilingual) and rank queries
 * by cosine similarity. Vectors are cached to disk so the index is built once.
 *
 * Provider contract (OpenAI-compatible):
 *   POST {baseUrl}/embeddings
 *   { model, input: string[] }
 *   Authorization: Bearer {apiKey}
 *   → { data: [{ embedding: number[], index }] }
 */
import type { CatalogEntry, EmbeddingConfig } from './types.ts';
export interface VectorRecord {
    id: string;
    v: number[];
}
export interface VectorIndex {
    version?: number;
    model: string;
    provider: string;
    endpoint?: string;
    catalogHash?: string;
    builtAt: string;
    dim: number;
    vectors: VectorRecord[];
}
/** Cosine similarity between two vectors (same length). */
export declare function cosine(a: number[], b: number[]): number;
/** Accept either an API base URL or a complete embeddings endpoint. */
export declare function embeddingEndpoint(baseUrl: string): string;
/** Call the provider to embed a batch of texts (≤100 per call). */
export declare function embedTexts(config: EmbeddingConfig, texts: string[], signal?: AbortSignal): Promise<number[][]>;
/** Search text used for one catalog entry. */
export declare function entrySearchText(entry: CatalogEntry): string;
export declare function catalogHash(entries: CatalogEntry[]): string;
/** Explain why an index cannot safely serve the current configuration. */
export declare function indexCompatibilityIssue(index: VectorIndex, config: EmbeddingConfig, entries?: CatalogEntry[]): string | undefined;
/** Disk-backed vector index for the catalog (v6). */
export declare class VectorStore {
    private readonly file;
    private index;
    constructor(dshHome: string);
    load(): Promise<VectorIndex | undefined>;
    save(index: VectorIndex): Promise<void>;
    get(): VectorIndex | undefined;
}
/** Build/refresh the vector index for the given entries (batched). */
export declare function buildIndex(config: EmbeddingConfig, store: VectorStore, entries: CatalogEntry[], signal?: AbortSignal, batchSize?: number): Promise<VectorIndex>;
/** Rank entries by cosine similarity to a query (top `limit`). */
export declare function semanticRank(config: EmbeddingConfig, store: VectorStore, entries: CatalogEntry[], query: string, limit: number, signal?: AbortSignal): Promise<CatalogEntry[]>;
