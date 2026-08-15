/**
 * Registration contract test: the BUILT artifacts (lib/) must expose the
 * shapes the DSH loader expects. Run `npm run build` before `npm test`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('built host entry', () => {
  let entry: { name?: string; inject?: string[]; apply?: unknown };
  beforeAll(async () => {
    entry = await import('../lib/index.js');
  });

  it('exports name/inject/apply', () => {
    expect(typeof entry.name).toBe('string');
    expect(Array.isArray(entry.inject)).toBe(true);
    expect(typeof entry.apply).toBe('function');
  });
});

describe('built client bundle', () => {
  it('is in the DSH module-loader format', async () => {
    const code = await readFile(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8');
    expect(code).toContain('window.__ModuleLoader__.load({');
    expect(code).toContain('id: "@dsh-community/plugin-panel"');
    expect(code).toContain('exports.apply = apply');
    expect(code).toContain('exports.inject = inject');
  });

  it('registers the sidebar entry id', async () => {
    const code = await readFile(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8');
    expect(code).toContain('sidebar.footer.action');
    expect(code).toContain('plugin-panel-market');
  });
});
