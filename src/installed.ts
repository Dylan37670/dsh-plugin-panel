/**
 * Installed-state detection: reads the DSH profile composition (bundles) and
 * the user skill root to decide what is already installed per profile.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstalledItem } from './types.ts';

export interface ManualRegistration {
  name: string;
  panelManaged: boolean;
}

function yamlScalar(value: string): string {
  const text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text.split(/\s+#/)[0].trim();
}

/** Read package names inserted by the profile's user patch layer. */
export async function readManualRegistrations(dshHome: string, profile: string): Promise<Map<string, ManualRegistration>> {
  const registrations = new Map<string, ManualRegistration>();
  let text = '';
  try { text = await readFile(join(dshHome, 'profiles', profile, 'cordis.patch.yml'), 'utf8'); } catch { return registrations; }
  const lines = text.split(/\r?\n/);
  let inInsert = false;
  let marker: string | undefined;
  for (const line of lines) {
    const marked = /^#\s*plugin-panel:manual\s+(.+?)\s*$/.exec(line);
    if (marked) {
      marker = yamlScalar(marked[1]);
      continue;
    }
    if (/^-\s+insert:\s*$/.test(line)) {
      inInsert = true;
      continue;
    }
    if (/^-\s+/.test(line)) {
      inInsert = false;
      marker = undefined;
    }
    if (!inInsert) continue;
    const named = /^\s+name:\s*(.+?)\s*$/.exec(line);
    if (!named) continue;
    const name = yamlScalar(named[1]);
    if (!name) continue;
    registrations.set(name, { name, panelManaged: marker === name });
    marker = undefined;
  }
  return registrations;
}

interface ProfilePackageJson {
  dependencies?: Record<string, string>;
  dsh?: { profile?: { bundles?: string[] } };
}

export async function readProfileManifest(dshHome: string, profile: string): Promise<ProfilePackageJson> {
  try {
    return JSON.parse(await readFile(join(dshHome, 'profiles', profile, 'package.json'), 'utf8')) as ProfilePackageJson;
  } catch { return {}; }
}

/** Read the bundle list of one profile ([] when the profile does not exist). */
export async function readProfileBundles(dshHome: string, profile: string): Promise<string[]> {
  const file = join(dshHome, 'profiles', profile, 'package.json');
  try {
    const parsed = await readProfileManifest(dshHome, profile);
    return parsed.dsh?.profile?.bundles ?? [];
  } catch {
    return [];
  }
}

/** Detect installed bundles + skills across the given profiles. */
export async function detectInstalled(
  dshHome: string,
  profiles: string[],
): Promise<InstalledItem[]> {
  const items: InstalledItem[] = [];
  const seen = new Set<string>();
  for (const profile of profiles) {
    const manifest = await readProfileManifest(dshHome, profile);
    const bundles = manifest.dsh?.profile?.bundles ?? [];
    const manual = await readManualRegistrations(dshHome, profile);
    for (const name of bundles) {
      const key = `bundle:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ name, kind: 'bundle', profile, enabled: true, packageName: name, spec: manifest.dependencies?.[name], activation: 'bundle' });
    }
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (bundles.includes(name)) continue;
      const key = `dependency:${profile}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const registration = manual.get(name);
      items.push(registration
        ? { name, kind: 'dependency', profile, enabled: true, packageName: name, spec, issue: '已启用（用户配置注册）', activation: 'manual', panelManaged: registration.panelManaged }
        : { name, kind: 'dependency', profile, enabled: false, packageName: name, spec, issue: '仅下载，未加入 Profile', activation: 'none' });
    }
  }
  // User skill root: any directory containing SKILL.md.
  const skillRoot = join(dshHome, 'skills');
  try {
    for (const name of await readdir(skillRoot, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const skillFile = join(skillRoot, name.name, 'SKILL.md');
      try {
        await access(skillFile);
        items.push({ name: name.name, kind: 'skill', enabled: true, packageName: name.name, activation: 'skill' });
      } catch {
        /* not a skill directory */
      }
    }
  } catch {
    /* no skill root */
  }
  return items;
}
