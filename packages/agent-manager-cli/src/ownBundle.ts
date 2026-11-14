import { fileURLToPath } from 'node:url';
import { resolveOwnBundlePath } from '@wadeck-app/shared-cli/resolveOwnBundlePath';

/** Basename of the bundle this CLI is shipped as, to tell its own LAUNCHER_BUNDLE_OVERRIDE from one leaked by another CLI's launcher. */
export const AGENT_MANAGER_BUNDLE_NAME = 'agent-manager.cjs';
export const UPDATER_BUNDLE_NAME = 'agent-manager-updater.cjs';
export const PACKAGE_NAME = '@wadeck-app/agent-manager-cli';

/** Path of agent-manager.cjs when running bundled; the running file itself in a plain tsc build (where there is no updater next to it). */
export function ownBundlePath(): string {
  return resolveOwnBundlePath(AGENT_MANAGER_BUNDLE_NAME, fileURLToPath(import.meta.url));
}
