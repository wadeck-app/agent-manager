import { CliError } from '../errors.js';

/** Decision 40: siblings use 47823, 47900, 47910-11, 47920-21. */
export const DEFAULT_DAEMON_PORT = 47930;
export const DAEMON_PORT_ENV = 'AGENT_MANAGER_DAEMON_PORT';

/**
 * The port of the daemon control server: the explicit value (tests: 0 = any free port), else $AGENT_MANAGER_DAEMON_PORT, else 47930. A set but
 * invalid variable is an error before anything starts, never a fall back to the default (the user asked for something else).
 */
export function resolveDaemonPort(env: NodeJS.ProcessEnv, explicit?: number): number {
  if (explicit !== undefined) {
    return explicit;
  }
  const raw = env[DAEMON_PORT_ENV];
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_DAEMON_PORT;
  }
  const port = Number(raw.trim());
  if (!/^\d+$/.test(raw.trim()) || !Number.isInteger(port) || port > 65535) {
    throw new CliError(`${DAEMON_PORT_ENV}=${JSON.stringify(raw)} is not a port (an integer from 0 to 65535). Fix: set it to a free port such as ${DEFAULT_DAEMON_PORT}, or unset it to use ${DEFAULT_DAEMON_PORT}`);
  }
  return port;
}
