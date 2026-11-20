import { DaemonAuthError, DaemonNotRunningError, DaemonPortExhaustedError, DaemonVersionError, createDaemonClient } from '@wadeck-app/singleton-daemon-kit';
import type { DaemonClient } from '@wadeck-app/singleton-daemon-kit';
import { CliError, DaemonUnreachableError, getErrorMessage } from '../errors.js';
import type { DaemonStatusPayload } from './runtime.js';

/** The commands the control server answers (see runtime.ts): the shape of what the CLI sends and gets back. */
export interface DaemonCommands {
  status: () => DaemonStatusPayload;
  shutdown: () => { stopping: boolean; live: number };
  [name: string]: (payload?: unknown) => unknown;
}

/**
 * A client of the control server of the daemon of this config folder. `commands` is empty on purpose: singleton-daemon-kit runs a local handler
 * when the daemon is not running, and nothing here may answer in the place of a daemon that is down: it must fail as unreachable.
 */
export function createControlClient(configDir: string): DaemonClient<DaemonCommands> {
  return createDaemonClient<DaemonCommands>({ configDir, commands: {} as DaemonCommands });
}

export const START_HINT = "start it with 'agent-manager start --detach' (or 'agent-manager start' in a terminal to see its output)";

/** The error a command shows for a failed call of the daemon: unreachable (exit 3) or a failure with its fix. */
export function daemonCallError(error: unknown, configDir: string): CliError {
  if (error instanceof DaemonNotRunningError) {
    return new DaemonUnreachableError(`the agent-manager daemon is not running (${getErrorMessage(error)}; config folder ${configDir}). Fix: ${START_HINT}`);
  }
  if (error instanceof DaemonAuthError) {
    return new CliError(`the daemon refused the token in ${configDir}/health_token (another daemon started with the same folder, or the file changed). Fix: 'agent-manager stop', then 'agent-manager start --detach'`);
  }
  if (error instanceof DaemonVersionError) {
    return new CliError(`the running daemon speaks another protocol version (${getErrorMessage(error)}). Fix: stop it with the agent-manager that started it, or end its process, then start it again`);
  }
  if (error instanceof DaemonPortExhaustedError) {
    return new CliError(`${getErrorMessage(error)}. Fix: free one of these ports, or set AGENT_MANAGER_DAEMON_PORT to a free port`);
  }
  const message = getErrorMessage(error);
  // A refused or reset connection while the port file says it runs: the daemon is gone or stuck.
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout/i.test(message)) {
    return new DaemonUnreachableError(`the agent-manager daemon did not answer (${message}; config folder ${configDir}). Fix: if it is stuck, end its process (see the pid in ${configDir}/config.port) and ${START_HINT}`);
  }
  return new CliError(`the daemon call failed (${message})`);
}
