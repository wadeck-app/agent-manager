/*
 * Exit codes (architecture decision 40: defined per command in a table, tested). The shared meaning of the numbers:
 * 0 ok, 1 failure (a CliError: the message says what to do), 2 usage (unknown option or command, a wrong argument), 3 the daemon is unreachable
 * (not running, or it did not answer), 70 an unexpected exception (a bug).
 * Note: the architecture text numbers timeout 2 and usage 4; this CLI has always used 2 for usage (every command, tested), and a timeout is a plain
 * failure (1) with the reason in the message. The table below is the one the help prints and the tests check.
 */
export const EXIT = { ok: 0, failure: 1, usage: 2, daemonUnreachable: 3, unexpected: 70 } as const;

export interface ExitCodeDoc {
  code: number;
  meaning: string;
}

/** What each daemon command can exit with. A command not listed documents only the shared codes (0, 1, 2, 70). */
export const COMMAND_EXIT_CODES: Readonly<Record<string, readonly ExitCodeDoc[]>> = {
  start: [
    { code: EXIT.ok, meaning: 'the daemon is running (started now, or it already was)' },
    { code: EXIT.failure, meaning: 'it could not start (port in use, unreadable owned-sessions.json, bad AGENT_MANAGER_DAEMON_PORT), or --detach saw it exit' },
    { code: EXIT.daemonUnreachable, meaning: 'a daemon seems to run (port file, live process) but does not answer, so it cannot be told from a stuck one' },
    { code: EXIT.usage, meaning: 'wrong option or argument' },
  ],
  stop: [
    { code: EXIT.ok, meaning: 'the daemon stopped, or it was not running (nothing to stop, said in the output)' },
    { code: EXIT.failure, meaning: 'it did not stop in time (its children are named: end them by hand)' },
    { code: EXIT.usage, meaning: 'wrong option or argument' },
  ],
  status: [
    { code: EXIT.ok, meaning: 'the daemon is running (its state is printed)' },
    { code: EXIT.daemonUnreachable, meaning: 'the daemon is not running or did not answer' },
    { code: EXIT.usage, meaning: 'wrong option or argument' },
  ],
};

/** The documented exit codes of a command. An unknown name is a bug of the caller, never an empty table. */
export function exitCodesOf(command: string): readonly ExitCodeDoc[] {
  const codes = Object.hasOwn(COMMAND_EXIT_CODES, command) ? COMMAND_EXIT_CODES[command] : undefined;
  if (codes === undefined) {
    throw new Error(`no exit codes are documented for the command '${command}': add it to COMMAND_EXIT_CODES in exitCodes.ts`);
  }
  return codes;
}
