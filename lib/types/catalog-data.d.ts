/**
 * Curated seed catalog.
 *
 * Sources (see README "致谢 / Credits"):
 *  - https://github.com/awesome-dsh-plugin/awesome-dsh-plugin (community index)
 *  - https://github.com/omdsh-dev (DSH plugin community org, migrated from dsh-external)
 *  - https://github.com/deepseek-ai/deepseek-harness (official)
 *
 * Descriptions are quoted or lightly adapted from each project's README /
 * the awesome list; `descriptionZh` are original Chinese translations written
 * for this panel. Entries are data only — no code is copied from any project.
 */
import type { CatalogEntry } from './types.ts';
export declare const SEED_ENTRIES: CatalogEntry[];
/** Map repo URL → seed entry, used to merge curated zh translations over live fetch results. */
export declare const SEED_BY_REPO: Map<string, CatalogEntry>;
