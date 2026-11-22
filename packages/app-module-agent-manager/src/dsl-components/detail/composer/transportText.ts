/** The longest sentence a transport row shows by default; the whole text is behind its Details toggle. */
export const SHORT_MAX = 70;

/**
 * The first clause of a server text, at most `max` characters: cut at the first ":", ";", " (" or ". " (the server writes the cause first and the detail after),
 * then cut with an ellipsis if it is still too long. The full text is always shown elsewhere (Details): nothing is lost, only moved.
 */
export function shortText(text: string, max: number = SHORT_MAX): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  const cut = /[:;]| \(|\. /.exec(clean);
  const clause = (cut === null || cut.index === 0 ? clean : clean.slice(0, cut.index)).trim();
  return clause.length <= max ? clause : `${clause.slice(0, max - 3).trimEnd()}...`;
}

/** The first command (text between backticks) of a fix sentence, to offer a copy button for it; undefined when the fix holds no command. */
export function firstCommand(fix: string): string | undefined {
  const found = /`([^`]+)`/.exec(fix);
  return found?.[1];
}
