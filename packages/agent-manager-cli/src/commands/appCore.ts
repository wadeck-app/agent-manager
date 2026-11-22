// agent-manager cli register | unregister -- tell app-core where the agent-manager app-module lives, or remove it.
import { type AppCoreAttempt, attemptStagedRegistration, attemptUnregistration } from '../AppCoreRegistration.js';
import { resolveAppModuleManifest } from '../appModuleManifest.js';
import type { Command, CommandOutput } from '../command.js';
import { CliError, getErrorMessage } from '../errors.js';

/**
 * Exit 0 when app-core took it, or is absent / not running (`deferred`, `skipped`: nothing to fix, said clearly). `unconfirmed`
 * (app-core is up but did not answer in time, it may have applied the call) is exit 0 too: nothing is known to be wrong, and a
 * script that needs certainty tests `status` in --json. Exit 1 with the reason when app-core refuses or the call fails.
 */
function outputOf(attempt: AppCoreAttempt): CommandOutput {
  if (!attempt.ok) {
    throw new CliError(attempt.message);
  }
  return { json: { ok: true, status: attempt.status, message: attempt.message }, lines: [attempt.message] };
}

export const registerCommand: Command = {
  name: 'cli register',
  summary: 'Show the Agents pages in app-core (the sessions of the Claude Code registry and of the daemon). This is the first registration: only this command does it; updates then keep it current',
  args: [],
  options: {},
  run: async () => {
    let manifestPath: string;
    try {
      manifestPath = resolveAppModuleManifest();
    } catch (error) {
      throw new CliError(getErrorMessage(error));
    }
    return outputOf(await attemptStagedRegistration(manifestPath));
  },
};

export const unregisterCommand: Command = {
  name: 'cli unregister',
  summary: 'Remove the Agents pages from app-core, and stop the updates from registering them again',
  args: [],
  options: {},
  run: async () => outputOf(await attemptUnregistration()),
};
