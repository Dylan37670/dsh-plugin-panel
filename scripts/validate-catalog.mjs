import { readFile } from 'node:fs/promises';

const [file = 'catalog/catalog.json', previousFile] = process.argv.slice(2);
const parsed = JSON.parse(await readFile(file, 'utf8'));
const manifest = parsed.manifest ?? {};
const entries = parsed.entries;

function fail(message) {
  console.error(`[validate-catalog] ${message}`);
  process.exit(1);
}

if (manifest.schema !== 'plugin-panel-catalog@1') fail('unsupported schema');
if (!Array.isArray(entries) || entries.length === 0) fail('entries is empty');
if (manifest.gaps !== 0) fail(`gaps must be 0 (got ${manifest.gaps})`);
const ids = entries.map((entry) => entry?.id);
if (ids.some((id) => typeof id !== 'string' || !id)) fail('entry has an invalid id');
if (new Set(ids).size !== ids.length) fail('entry ids are not unique');
const invalidInstall = entries.find((entry) => entry?.installVerified === true
  && (typeof entry.install !== 'string' || entry.install.length === 0 || /[\r\n;&|<>]/.test(entry.install)));
if (invalidInstall) fail(`verified install target is invalid: ${invalidInstall.id}`);
if (manifest.count !== entries.length) fail(`manifest count ${manifest.count} != ${entries.length}`);
const verifiedCount = entries.filter((entry) => entry?.installVerified === true).length;
if (Number(manifest.installVerifiedCount ?? verifiedCount) !== verifiedCount) fail(`manifest installVerifiedCount does not match ${verifiedCount}`);
const totalHits = Number(manifest.totalHits ?? 0);
const fetchedCount = Number(manifest.fetchedCount ?? 0);
const coverage = totalHits > 0 ? (fetchedCount / totalHits) * 100 : 100;
if (coverage < 99) fail(`coverage ${coverage.toFixed(3)}% is below 99%`);

if (previousFile) {
  try {
    const previous = JSON.parse(await readFile(previousFile, 'utf8'));
    const previousCount = Array.isArray(previous.entries) ? previous.entries.length : 0;
    if (previousCount > 0 && entries.length < previousCount * 0.95) {
      fail(`entry count ${entries.length} fell below 95% of previous ${previousCount}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

console.log(`[validate-catalog] ok: ${entries.length} entries, ${verifiedCount} verified installs, ${totalHits} topic hits, ${coverage.toFixed(3)}% coverage`);
