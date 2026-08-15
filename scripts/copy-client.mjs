/**
 * Build step: copy the hand-written client bundle into lib/.
 * The client is authored directly in the DSH module-loader format, so no
 * bundling is needed — only placement.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const src = join(root, 'src', 'client', 'client.js');
const destDir = join(root, 'lib');
const dest = join(destDir, 'client.js');

await mkdir(destDir, { recursive: true });
await copyFile(src, dest);
console.log(`[plugin-panel] client bundle copied: ${dest}`);
