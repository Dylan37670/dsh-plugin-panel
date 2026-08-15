/**
 * Panel state persistence: favorites + settings stored as one JSON document
 * under `$DSH_HOME/plugin-panel/state.json` (atomic write via temp + rename).
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_STATE, type PanelState } from './types.ts';

export class StateStore {
  private readonly file: string;
  private current: PanelState;

  constructor(dshHome: string) {
    this.file = join(dshHome, 'plugin-panel', 'state.json');
    this.current = DEFAULT_STATE;
  }

  async load(): Promise<PanelState> {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PanelState>;
      this.current = {
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        settings: { ...DEFAULT_STATE.settings, ...(parsed.settings ?? {}) },
      };
    } catch {
      this.current = structuredClone(DEFAULT_STATE);
    }
    return this.current;
  }

  async save(next: PanelState): Promise<PanelState> {
    this.current = {
      favorites: Array.isArray(next.favorites) ? next.favorites : [],
      settings: { ...DEFAULT_STATE.settings, ...(next.settings ?? {}) },
    };
    await mkdir(join(this.file, '..'), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.current, null, 2), 'utf8');
    await rename(tmp, this.file);
    return this.current;
  }

  /** Toggle one favorite id; returns the new favorites list. */
  async toggleFavorite(id: string): Promise<string[]> {
    const current = this.current.favorites.includes(id)
      ? this.current.favorites.filter((f) => f !== id)
      : [...this.current.favorites, id];
    this.current = { ...this.current, favorites: current };
    await this.save(this.current);
    return current;
  }

  get(): PanelState {
    return this.current;
  }
}
