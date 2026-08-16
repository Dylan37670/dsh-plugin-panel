/**
 * Panel state persistence: favorites + settings stored as one JSON document
 * under `$DSH_HOME/plugin-panel/state.json` (atomic write via temp + rename).
 */
import { type PanelState } from './types.ts';
export declare class StateStore {
    private readonly file;
    private current;
    constructor(dshHome: string);
    load(): Promise<PanelState>;
    save(next: PanelState): Promise<PanelState>;
    /** Merge only supplied settings. Nested embedding fields are preserved. */
    patchSettings(patch: Partial<PanelState['settings']>): Promise<PanelState>;
    /** Toggle one favorite id; returns the new favorites list. */
    toggleFavorite(id: string): Promise<string[]>;
    get(): PanelState;
}
