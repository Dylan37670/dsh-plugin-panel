/**
 * Installed-state detection: reads the DSH profile composition (bundles) and
 * the user skill root to decide what is already installed per profile.
 */
import type { InstalledItem } from './types.ts';
interface ProfilePackageJson {
    dependencies?: Record<string, string>;
    dsh?: {
        profile?: {
            bundles?: string[];
        };
    };
}
export declare function readProfileManifest(dshHome: string, profile: string): Promise<ProfilePackageJson>;
/** Read the bundle list of one profile ([] when the profile does not exist). */
export declare function readProfileBundles(dshHome: string, profile: string): Promise<string[]>;
/** Detect installed bundles + skills across the given profiles. */
export declare function detectInstalled(dshHome: string, profiles: string[]): Promise<InstalledItem[]>;
export {};
