// agent-manager start | stop | status -- the daemon lifecycle. NOT IMPLEMENTED (M1b is the partial slice with the sessions overview in app-core only): each command fails explicitly, never succeeds silently.
import type { Command } from '../command.js';
import { CliError } from '../errors.js';

export const DAEMON_NOT_IMPLEMENTED = 'daemon not implemented yet (planned M1b)';

function notImplemented(name: string, summary: string): Command {
  return {
    name,
    summary: `${summary} (not implemented yet: fails with an error)`,
    args: [],
    options: {},
    run: () => {
      throw new CliError(`${DAEMON_NOT_IMPLEMENTED}: 'agent-manager ${name}' did nothing. This build is the M1b partial slice: no daemon, hooks, transcripts or replies yet; only the sessions overview of the Claude Code registry exists, in app-core ('agent-manager cli register')`);
    },
  };
}

export const startCommand = notImplemented('start', 'Start the daemon');
export const stopCommand = notImplemented('stop', 'Stop the daemon');
export const statusCommand = notImplemented('status', 'Show the daemon status');
