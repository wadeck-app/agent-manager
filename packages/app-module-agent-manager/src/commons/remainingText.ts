/** "42 s", "29 min", "1 h 05 min": the time left of a grant (shared by the page and by GET /guardrails/sessions/:sessionId/grants). */
export function remainingText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 'expired';
  }
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
}
