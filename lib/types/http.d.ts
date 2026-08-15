/**
 * HTTP layer: one prefix route `/api/plugin-panel` serving the panel's JSON
 * endpoints. Requests from non-loopback peers are rejected (the web server
 * binds 127.0.0.1 by default; this is a second, cheap guard).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CatalogService } from './catalog.ts';
import type { StateStore } from './state.ts';
import { type LifecycleContext } from './lifecycle.ts';
import { type TranslationRoute } from './translate.ts';
import type { TranslationStore } from './translate.ts';
import { type VectorStore } from './embeddings.ts';
export interface PanelRoutes {
    catalog: CatalogService;
    state: StateStore;
    lifecycle: LifecycleContext;
    profiles: string[];
    /** Lazily-resolved LLM route for on-demand zh translation (v5.1). */
    translate: {
        get: () => TranslationRoute;
    };
    translations: TranslationStore;
    /** Disk-backed vector index for semantic search (v6). */
    vectors: VectorStore;
}
export declare function createPanelHandler(routes: PanelRoutes): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
