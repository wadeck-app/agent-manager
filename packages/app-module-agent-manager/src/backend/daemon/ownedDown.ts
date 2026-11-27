import { defaultConfigDir, getErrorMessage } from '@wadeck-app/agent-manager-core';
import { ownedStatePath, readOwnedState } from '@wadeck-app/agent-manager-core/launch';
// violations-suppress: ts/no-deep-relative the module's own commons/ contract, one level above this subfolder
import type { ApiError, OwnedDown } from '../../commons/api.js';
import { START_COMMAND } from './daemonApi.js';

/** What GET /sessions says about owned sessions whose daemon cannot be asked; both texts are empty when there is nothing to say. */
export interface OwnedDownReport {
  ownedDown: OwnedDown | null;
  ownedDownText: string;
  /** The state file itself cannot be used (unreadable, not JSON, unknown version): its own message, with the path and the fix. */
  ownedStateErrorText: string;
}

const NOTHING: OwnedDownReport = { ownedDown: null, ownedDownText: '', ownedStateErrorText: '' };

/**
 * The persistent banner of the Agents workspace: shown only when the daemon cannot be asked (`ownedError`) AND owned-sessions.json lists at least one
 * session (a user who never used the daemon has no file, or an empty one: nothing is said). The file is read-only here (the daemon owns it), with the same
 * strict reader as the daemon: a file it cannot understand is reported as `ownedStateErrorText`, never taken for "no sessions".
 */
export async function ownedDownOf(ownedError: ApiError | null, env: NodeJS.ProcessEnv = process.env): Promise<OwnedDownReport> {
  if (ownedError === null) {
    return NOTHING;
  }
  const path = ownedStatePath(defaultConfigDir(env));
  let count: number;
  try {
    count = (await readOwnedState(path)).length;
  } catch (error) {
    // A LaunchError message already ends with its own `Fix: ...` sentence: it is the message alone, never the message plus the fix again.
    return { ...NOTHING, ownedStateErrorText: `The daemon cannot be asked and ${getErrorMessage(error)}` };
  }
  if (count === 0) {
    return NOTHING;
  }
  // A daemon that is running but refuses or fails has its own fix (the hint of the error); a daemon that is not running starts with the command.
  const notRunning = ownedError.code === 'daemon-not-running';
  const fix = notRunning ? START_COMMAND : ownedError.hint;
  const noun = count === 1 ? '1 owned session' : `${count} owned sessions`;
  const why = notRunning ? 'the daemon is not running' : `the daemon cannot be asked (${ownedError.message})`;
  const ownedDownText = `${noun} ${count === 1 ? 'is' : 'are'} listed in ${path} but ${why}: Stop, Resume and Hand over are unavailable and ${count === 1 ? 'it shows' : 'they show'} as plain rows. Fix: ${notRunning ? `run \`${START_COMMAND}\`` : fix}`;
  return { ownedDown: { count, fix }, ownedDownText, ownedStateErrorText: '' };
}
