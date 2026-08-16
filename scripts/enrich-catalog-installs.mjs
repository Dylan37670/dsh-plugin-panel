/** Overlay verified install targets onto an existing full topic catalog. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCommunityRegistry } from '../lib/catalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(ROOT, 'catalog', 'catalog.json');
const registryUrl = process.env.INSTALL_REGISTRY_URL
  ?? 'https://raw.githubusercontent.com/dsh-market/dsh-market/main/data/registry-snapshot.json';

function rootSlug(url) {
  return url?.match(/^https:\/\/github\.com\/([^/]+\/[^/#]+)/i)?.[1]?.toLowerCase();
}

const catalog = JSON.parse(await readFile(file, 'utf8'));
const response = await fetch(registryUrl, { headers: { 'User-Agent': 'dsh-plugin-panel-catalog' } });
if (!response.ok) throw new Error(`install registry returned HTTP ${response.status}`);
const registry = parseCommunityRegistry(await response.json());
const byRoot = new Map();
for (const candidate of registry) {
  const root = rootSlug(candidate.repo);
  if (!root || !candidate.installVerified) continue;
  const repoName = root.split('/')[1];
  const score = (candidate.repo?.toLowerCase() === `https://github.com/${root}` ? 100 : 0)
    + (candidate.npm ? 50 : 0)
    + (candidate.title.toLowerCase() === repoName ? 30 : 0)
    + (candidate.title.toLowerCase().endsWith('-all') ? 25 : 0);
  if (!byRoot.has(root) || score > byRoot.get(root).score) byRoot.set(root, { score, candidate });
}
for (const entry of catalog.entries ?? []) {
  if (entry.installVerified !== true) {
    delete entry.installVerified;
    delete entry.installSource;
  }
  if (entry.id === 'csyangwen/dsh-memory-evolve') {
    entry.install = 'github:csyangwen/dsh-memory-evolve';
    entry.installVerified = true;
    entry.installSource = 'author';
  }
  const candidate = byRoot.get(rootSlug(entry.repo))?.candidate;
  if (!candidate) continue;
  entry.install = candidate.install;
  entry.installVerified = true;
  entry.installSource = 'community';
  if (candidate.npm) entry.npm = candidate.npm;
  if (candidate.descriptionZh) entry.descriptionZh = candidate.descriptionZh;
}
catalog.manifest.installVerifiedCount = (catalog.entries ?? []).filter((entry) => entry.installVerified).length;
catalog.manifest.installRegistry = registryUrl;
catalog.manifest.count = (catalog.entries ?? []).length;
const tmp = `${file}.tmp`;
await writeFile(tmp, JSON.stringify(catalog, null, 2), 'utf8');
await rename(tmp, file);
console.log(`[enrich-catalog-installs] ${(catalog.entries ?? []).length} entries, ${catalog.manifest.installVerifiedCount} verified install targets`);
