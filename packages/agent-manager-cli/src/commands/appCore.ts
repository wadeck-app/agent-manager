// agent-manager cli register | unregister -- tell app-core where the agent-manager app-module lives, or remove it.
// NOT IMPLEMENTED in the M1 skeleton (there is no app-module yet): each command fails explicitly, never succeeds silently.
import type { Command } from '../command.js';
import { CliError } from '../errors.js';

export const APP_MODULE_NOT_IMPLEMENTED = 'app-core module not implemented yet (planned M1b)';

function notImplemented(name: string, summary: string): Command {
  return {
    name,
    summary: `${summary} (not implemented yet: fails with an error)`,
    args: [],
    options: {},
    run: () => {
      throw new CliError(`${APP_MODULE_NOT_IMPLEMENTED}: 'agent-manager ${name}' did nothing. This build is the M1 skeleton: there is no app-module to register`);
    },
  };
}

export const registerCommand = notImplemented('cli register', 'Show the agent-manager pages in app-core');
export const unregisterCommand = notImplemented('cli unregister', 'Remove the agent-manager pages from app-core');
