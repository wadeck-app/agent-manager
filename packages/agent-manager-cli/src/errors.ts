/** The command line is wrong (unknown command or option, missing argument): exit code 2 with a hint to run --help. */
export class UsageError extends Error {
  /** Command whose `--help` explains the usage, as typed: 'agent-manager' or 'agent-manager add'. */
  readonly command: string;

  constructor(message: string, command = 'agent-manager') {
    super(message);
    this.name = 'UsageError';
    this.command = command;
  }
}

/** A command failed for a reason the user can act on (exit code 1 unless said otherwise, message only, no stack). */
export class CliError extends Error {
  /** The exit code of the process. */
  readonly exitCode: number;
  /** Stable identifier written to the log. */
  readonly logCode: string;

  constructor(message: string, exitCode = 1, logCode = 'CLI_ERROR') {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.logCode = logCode;
  }
}

/** The daemon is not running or did not answer: exit code 3 (decision 40). */
export class DaemonUnreachableError extends CliError {
  constructor(message: string) {
    super(message, 3, 'DAEMON_UNREACHABLE');
    this.name = 'DaemonUnreachableError';
  }
}

/** The message of anything that was thrown: the message of an Error, else the thrown value as text. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
