// agent-manager start | stop | status -- the daemon lifecycle. NOT IMPLEMENTED in the M1 skeleton: each command fails explicitly, never succeeds silently.
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
      throw new CliError(`${DAEMON_NOT_IMPLEMENTED}: 'agent-manager ${name}' did nothing. This build is the M1 skeleton: no daemon, hooks or UI yet`);
    },
  };
}

export const startCommand = notImplemented('start', 'Start the daemon');
export const stopCommand = notImplemented('stop', 'Stop the daemon');
export const statusCommand = notImplemented('status', 'Show the daemon status');
