import type { TranslationItem, TranslationResult } from './types.ts';
export interface LlmLike {
    stream(options: {
        provider: string;
        model: string;
        system?: string;
        messages: Array<{
            id?: string;
            role: string;
            content: Array<{
                type: string;
                text: string;
            }>;
            source?: {
                kind: string;
            };
        }>;
        maxTokens?: number;
        temperature?: number;
    }): AsyncIterable<unknown>;
}
export declare function userMessage(text: string): {
    id: string;
    role: 'user';
    content: Array<{
        type: 'text';
        text: string;
    }>;
    source: {
        kind: 'user';
    };
};
export interface ModelRouteLike {
    provider?: string;
    model?: string;
}
export interface TranslationRoute {
    llm?: LlmLike;
    route?: ModelRouteLike;
    /** Injectable for tests; defaults to global fetch. */
    fetch?: typeof fetch;
}
/** Parse JSON/JSONL replies, with the v6.4 numbered format kept for compatibility. */
export declare function parseTranslationReply(reply: string): Map<number, [string, string]>;
/** Extract text from the stream shapes used by current and older DSH adapters. */
export declare function chunkText(chunk: unknown): string;
export declare class TranslationStore {
    private readonly file;
    private cache;
    private writeChain;
    constructor(dshHome: string);
    load(): Promise<void>;
    get(id: string): TranslationResult | undefined;
    setMany(items: TranslationItem[], results: TranslationResult[]): Promise<void>;
    partition(items: TranslationItem[]): {
        missing: TranslationItem[];
        cached: TranslationResult[];
    };
}
/** Translate every requested item; partial model replies no longer drop the rest. */
export declare function translateBatch(route: TranslationRoute, store: TranslationStore, items: TranslationItem[], signal?: AbortSignal): Promise<TranslationResult[]>;
