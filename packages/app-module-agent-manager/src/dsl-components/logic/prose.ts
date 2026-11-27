/**
 * A server or daemon text as a sentence for the user: no markdown backticks (the quoted words stay, in double quotes), and every sentence starts with a capital
 * (the daemon writes "resume the session" after a full stop). Only a plain word is capitalised: a file name, a command or a path at the start of a sentence
 * ("agents-user-state.json is not valid JSON", "agent-manager start") is left as it is.
 */
export function prose(text: string): string {
  const unquoted = text.replace(/`([^`]*)`/g, '"$1"').trim();
  return unquoted.replace(/(^|[.!?]\s+)([a-z])([a-z]*)(?=[\s,;:]|$)/g, (_all, lead: string, first: string, rest: string) => `${lead}${first.toUpperCase()}${rest}`);
}
