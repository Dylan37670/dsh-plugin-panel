/**
 * Installed-state detection: reads the DSH profile composition (bundles) and
 * the user skill root to decide what is already installed per profile.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstalledItem } from './types.ts';

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
    for (const name of bundles) {
      const key = `bundle:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ name, kind: 'bundle', profile, enabled: true, packageName: name, spec: manifest.dependencies?.[name] });
    }
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (bundles.includes(name)) continue;
      const key = `dependency:${profile}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ name, kind: 'dependency', profile, enabled: false, packageName: name, spec, issue: '未启用：缺少 dsh.bundle' });
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
        items.push({ name: name.name, kind: 'skill', enabled: true, packageName: name.name });
      } catch {
        /* not a skill directory */
      }
    }
  } catch {
    /* no skill root */
  }
  return items;
}
