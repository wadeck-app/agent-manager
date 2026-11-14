import { getErrorMessage } from '../errors.js';
import type { UpdateCache, UpdateState, UpdaterConfig } from '@wadeck-app/shared-updater';
import { devBuildRefusalMessage, isReleaseVersion } from '@wadeck-app/shared-cli/ReleaseVersion';
import { describeOutcome } from './outcome.js';
import { selfCheckCommand } from './selfCheckCommand.js';

export const PKG_NAME = '@wadeck-app/agent-manager-cli';

/** Everything the updater touches outside its own logic, so it can be run against fakes. */
export interface UpdaterDeps {
  /** process.env: shared-updater reads UPDATER_SELF_CHECK_CMD and UPDATER_FORCE from it. */
  env: NodeJS.ProcessEnv;
  configDir: string;
  version: string;
  nodePath: string;
  npmRootGlobal: () => string;
  runUpdater: (config: UpdaterConfig) => Promise<void>;
  readCache: () => UpdateCache | null;
  readState: () => UpdateState | null;
  /** Where the cache and the state live, for the messages. */
  cacheFile: string;
  stateFile: string;
  writeState: (state: UpdateState) => void;
  now: () => number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/**
 * The background (or `agent-manager cli update`) update run; returns the exit code.
 * UPDATER_FORCE=1 means the user asked for it: the outcome is then printed, never silent.
 */
export async function runAgentManagerUpdater(deps: UpdaterDeps): Promise<number> {
  const { env, stdout, stderr } = deps;
  const force = env['UPDATER_FORCE'] === '1';
  const startedAt = deps.now();

  // A repo-built updater must never touch the global install (an interrupted `npm install -g` can leave the CLI uninstalled).
  if (!isReleaseVersion(deps.version)) {
    stderr(`[agent-manager-updater] ${devBuildRefusalMessage('agent-manager', deps.version)}`);
    return 1;
  }

  if (!env['UPDATER_SELF_CHECK_CMD']) {
    try {
      env['UPDATER_SELF_CHECK_CMD'] = selfCheckCommand(deps.npmRootGlobal, deps.nodePath);
    } catch (error) {
      const message = getErrorMessage(error);
      stderr(`[agent-manager-updater] fatal: ${message}`);
      // Nobody watches a background run: the next command shows this failure through the update notice.
      deps.writeState({ status: 'failed', currentVersion: deps.version, error: message, timestamp: deps.now() });
      return 1;
    }
  }

  let crash: unknown;
  try {
    await deps.runUpdater({
      pkgName: PKG_NAME,
      configDir: deps.configDir,
      currentVersion: deps.version,
      strategy: 'without-daemon',
      onUpdateAvailable: async () => 'apply-now' as const,
    });
  } catch (error) {
    crash = error;
  }
  if (force) {
    for (const line of describeOutcome({ currentVersion: deps.version, startedAt, cache: deps.readCache(), state: deps.readState(), cacheFile: deps.cacheFile, stateFile: deps.stateFile })) {
      stdout(line);
    }
  }
  if (crash !== undefined) {
    stderr(`[agent-manager-updater] fatal: ${String(crash)}`);
    return 1;
  }
  return 0;
}
