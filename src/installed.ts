/**
 * Installed-state detection: reads the DSH profile composition (bundles) and
 * the user skill root to decide what is already installed per profile.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstalledItem } from './types.ts';

interface ProfilePackageJson {
  dsh?: { profile?: { bundles?: string[] } };
}

/** Read the bundle list of one profile ([] when the profile does not exist). */
export async function readProfileBundles(dshHome: string, profile: string): Promise<string[]> {
  const file = join(dshHome, 'profiles', profile, 'package.json');
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as ProfilePackageJson;
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
    for (const name of await readProfileBundles(dshHome, profile)) {
      const key = `bundle:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ name, kind: 'bundle', profile });
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
        items.push({ name: name.name, kind: 'skill' });
      } catch {
        /* not a skill directory */
      }
    }
  } catch {
    /* no skill root */
  }
  return items;
}
