import { describe, expect, it } from 'vitest';
import { CliError } from '../errors.js';
import { DAEMON_PORT_ENV, DEFAULT_DAEMON_PORT, resolveDaemonPort } from './daemonPort.js';

describe('resolveDaemonPort', () => {
  it('defaults to 47930', () => {
    expect(DEFAULT_DAEMON_PORT).toBe(47930);
    expect(resolveDaemonPort({})).toBe(47930);
    expect(resolveDaemonPort({ [DAEMON_PORT_ENV]: '  ' })).toBe(47930);
  });

  it('takes AGENT_MANAGER_DAEMON_PORT, including 0 (any free port)', () => {
    expect(resolveDaemonPort({ [DAEMON_PORT_ENV]: '48001' })).toBe(48001);
    expect(resolveDaemonPort({ [DAEMON_PORT_ENV]: '0' })).toBe(0);
  });

  it('prefers the explicit value (tests)', () => {
    expect(resolveDaemonPort({ [DAEMON_PORT_ENV]: '48001' }, 0)).toBe(0);
  });

  it.each(['abc', '65536', '-5', '1.5', '0x10', '1e3'])('refuses %s with the variable name and a fix, never the default', (value) => {
    let failure: unknown;
    try {
      resolveDaemonPort({ [DAEMON_PORT_ENV]: value });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CliError);
    expect((failure as Error).message).toContain(DAEMON_PORT_ENV);
    expect((failure as Error).message).toContain('Fix:');
  });
});
