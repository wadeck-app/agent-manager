import type { UpdateState } from '@wadeck-app/shared-cli';

/**
 * What to tell the user about the background update run that happened since the last command.
 * The statuses are those of shared-cli's UpdateManager, which already maps the legacy 'update-failed' to 'failed'.
 */
export function updateNoticeLines(state: UpdateState | null): string[] {
  // No state, or a status that needs no message (applying, deferred): nothing to announce.
  if (state === null) {
    return [];
  }
  if (state.status === 'success') {
    return [`[agent-manager] Updated to v${state.targetVersion ?? state.newVersion}${state.previousVersion === undefined ? '' : ` (was v${state.previousVersion}). To go back: agent-manager cli rollback`}`];
  }
  if (state.status === 'rolled-back') {
    return [`[agent-manager] Update to v${state.targetVersion} failed (self-check failed). Rolled back to v${state.previousVersion}. Run: agent-manager cli logs`];
  }
  if (state.status === 'failed') {
    return [`[agent-manager] Background update failed (${state.error ?? 'no reason recorded'}). Run: agent-manager cli update`];
  }
  return [];
}

/** An update that was cut short inside the install: the state says what was being installed and what to go back to. */
export function interruptedUpdateLine(state: Pick<UpdateState, 'targetVersion' | 'previousVersion'>): string {
  return `[agent-manager] An update to v${state.targetVersion} was interrupted (previous version v${state.previousVersion}). Repair it with: agent-manager cli update`;
}
