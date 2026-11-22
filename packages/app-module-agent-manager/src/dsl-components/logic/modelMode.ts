/** The closed summary of the "Model and mode" options of the Fork and Thread dialogs: what the new session gets, in a few words (the details are the tooltip). */
export function modelModeSummary({ known, changed }: { known: boolean; changed: boolean }): string {
  if (changed) {
    return 'Model and mode: changed';
  }
  return known ? 'Model and mode: same as the session' : 'Model and mode: Claude Code default';
}
