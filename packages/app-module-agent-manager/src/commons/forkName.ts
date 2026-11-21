/** The longest name the daemon accepts (the same limit as MAX_NAME_CHARS of agent-manager-core; a test keeps the two equal). */
export const FORK_NAME_MAX = 64;

/**
 * The default name of a fork, "fork of <name>": ONE helper for the route and the dialog. The source name comes from a registry file or a record, so it is
 * cleaned first (control characters and line breaks become a space, runs of spaces collapse: the daemon refuses a name that is not a single line, for a
 * field the caller never sent), then cut to FORK_NAME_MAX with an ellipsis mark. A name with nothing left reads "session".
 */
export function forkNameOf(sourceName: string, prefix = 'fork of'): string {
  const clean = oneLineOf(sourceName);
  const name = `${prefix} ${clean === '' ? 'session' : clean}`;
  return name.length <= FORK_NAME_MAX ? name : `${name.slice(0, FORK_NAME_MAX - 3)}...`;
}

/** Characters of the message that name a thread. */
export const THREAD_NAME_CHARS = 40;

/** The default name of a thread opened on a message, "thread: <first 40 characters of the message>" (one line, never empty): the dialog's default. */
export function threadNameOf(messageText: string): string {
  const clean = oneLineOf(messageText);
  return `thread: ${clean === '' ? 'message' : clean.slice(0, THREAD_NAME_CHARS).trim()}`;
}

function oneLineOf(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
