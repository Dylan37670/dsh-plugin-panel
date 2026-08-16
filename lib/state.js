/**
 * Panel state persistence: favorites + settings stored as one JSON document
 * under `$DSH_HOME/plugin-panel/state.json` (atomic write via temp + rename).
 */
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_STATE } from "./types.js";
export class StateStore {
    file;
    current;
    constructor(dshHome) {
        this.file = join(dshHome, 'plugin-panel', 'state.json');
        this.current = DEFAULT_STATE;
    }
    async load() {
        try {
            const raw = await readFile(this.file, 'utf8');
            const parsed = JSON.parse(raw);
            this.current = {
                favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
                settings: {
                    ...DEFAULT_STATE.settings,
                    ...(parsed.settings ?? {}),
                    embedding: {
                        ...DEFAULT_STATE.settings.embedding,
                        ...(parsed.settings?.embedding ?? {}),
                    },
                },
            };
        }
        catch {
            this.current = structuredClone(DEFAULT_STATE);
        }
        return this.current;
    }
    async save(next) {
        this.current = {
            favorites: Array.isArray(next.favorites) ? next.favorites : [],
            settings: {
                ...DEFAULT_STATE.settings,
                ...(next.settings ?? {}),
                embedding: {
                    ...DEFAULT_STATE.settings.embedding,
                    ...(next.settings?.embedding ?? {}),
                },
            },
        };
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, JSON.stringify(this.current, null, 2), { encoding: 'utf8', mode: 0o600 });
        await rename(tmp, this.file);
        if (process.platform !== 'win32')
            await chmod(this.file, 0o600);
        return this.current;
    }
    /** Merge only supplied settings. Nested embedding fields are preserved. */
    async patchSettings(patch) {
        const embedding = patch.embedding === undefined
            ? this.current.settings.embedding
            : { ...DEFAULT_STATE.settings.embedding, ...this.current.settings.embedding, ...patch.embedding };
        return this.save({
            ...this.current,
            settings: { ...this.current.settings, ...patch, embedding },
        });
    }
    /** Toggle one favorite id; returns the new favorites list. */
    async toggleFavorite(id) {
        const current = this.current.favorites.includes(id)
            ? this.current.favorites.filter((f) => f !== id)
            : [...this.current.favorites, id];
        this.current = { ...this.current, favorites: current };
        await this.save(this.current);
        return current;
    }
    get() {
        return this.current;
    }
}
