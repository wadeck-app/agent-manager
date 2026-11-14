import type { UpdateCache, UpdateState } from '@wadeck-app/shared-updater';

export interface OutcomeInput {
  currentVersion: string;
  /** Epoch ms when this updater run started: only traces written after it belong to this run. */
  startedAt: number;
  cache: UpdateCache | null;
  state: UpdateState | null;
  cacheFile: string;
  stateFile: string;
}

const PREFIX = '[agent-manager-updater]';

function statusOf(input: OutcomeInput): string {
  const { state, cache, startedAt } = input;
  if (state !== null && state.timestamp >= startedAt) {
    switch (state.status) {
      case 'success':
        return `updated to ${state.targetVersion}`;
      case 'failed':
        return `update failed -- ${state.error}`;
      case 'rolled-back':
        return `update rolled back to ${state.previousVersion} -- the new version failed its self-check`;
      case 'deferred': {
        const minutes = Math.round(((state.retryAt ?? state.timestamp) - state.timestamp) / 60_000);
        return `deferred -- will retry automatically in ${minutes} minute${minutes === 1 ? '' : 's'}`;
      }
      default:
        // 'update-available' is only written by the 'with-daemon' strategy, which this CLI never uses.
        return `unexpected state '${state.status}' in ${input.stateFile}`;
    }
  }
  if (cache !== null && cache.lastCheckedAt >= startedAt) {
    // The cache was refreshed by this run and no state was written: the latest version is not newer than the current one.
    return 'up to date';
  }
  return `unknown -- this run wrote neither ${input.cacheFile} nor ${input.stateFile} (the version check failed or another update is running); see: agent-manager cli logs`;
}

/** The three lines `agent-manager cli update` prints: current version, latest known version, and what this run did. */
export function describeOutcome(input: OutcomeInput): string[] {
  return [
    `${PREFIX} current: ${input.currentVersion}`,
    `${PREFIX} latest:  ${input.cache?.latestVersion ?? 'unknown (no cache file)'}`,
    `${PREFIX} status:  ${statusOf(input)}`,
  ];
}
