/** Short codes of the programs a session can run under, as the status line chip shows them ("CCv2.1.325"). Data, not logic. */
const PROGRAMS: ReadonlyMap<string, string> = new Map([
  ['claude code', 'CC'],
  ['opencode', 'OC'],
  ['codex', 'Cx'],
]);

/**
 * The harness of a session ("Claude Code 2.1.325") as a short chip text "CCv2.1.325" (OpenCode: OC, Codex: Cx) and the full name for the tooltip.
 * A program that is not in the table is returned unchanged: an unknown program is shown, not renamed by a guess.
 */
export function harnessChip(harness: string): { short: string; full: string } {
  const match = /^(.*?)(?:\s+v?(\d[\w.+-]*))?$/.exec(harness.trim());
  const program = match?.[1] ?? harness;
  const version = match?.[2];
  const code = PROGRAMS.get(program.trim().toLowerCase());
  if (code === undefined) {
    return { short: harness, full: harness };
  }
  return { short: version === undefined ? code : `${code}v${version}`, full: harness };
}
