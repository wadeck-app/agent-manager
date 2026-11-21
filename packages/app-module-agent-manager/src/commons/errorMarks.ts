/**
 * The shell fetcher of app-core (the only client that can answer the PIN dialog) throws the top-level `message` of an error body and nothing else, so the
 * machine code of an error of a sensitive route never reaches the page. The codes the page must ACT on (not just show) travel as a prefix of that message,
 * "[code] ", written by the route kit (backend/routeKit.ts) and taken off by the page (dsl-components/data/http.ts) before the user reads it.
 * `switch-not-ready`: the daemon found something running (or something it cannot check) that the page did not show; `switch-draft`: text is typed in the terminal and
 * ending claude would lose it. Both: the page asks the user to confirm (force) instead of failing.
 */
export const MARKED_ERROR_CODES: readonly string[] = ['switch-not-ready', 'switch-draft'];

export function markMessage(code: string | undefined, text: string): string {
  return code !== undefined && MARKED_ERROR_CODES.includes(code) ? `[${code}] ${text}` : text;
}

export function unmarkMessage(text: string): { text: string; code?: string } {
  const match = /^\[([a-z0-9-]+)\] /.exec(text);
  const code = match?.[1];
  return code !== undefined && MARKED_ERROR_CODES.includes(code) ? { text: text.slice((match?.[0].length ?? 0)), code } : { text };
}
