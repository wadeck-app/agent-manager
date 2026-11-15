/** "367.8k", "1.2M", "816": the style of the Claude Code status line. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(Math.round(count));
}

/** "2h22m", "35m", "<1m": the style of the status line (no seconds). */
export function formatSpan(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return '<1m';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

/** The colour class family of the context meter: green below 70 %, yellow below 90 %, red from 90 %. Written in full for Tailwind. */
export function contextTone(value: number): { text: string; bar: string; label: string } {
  if (value >= 90) {
    return { text: 'text-hue-red', bar: 'bg-hue-red', label: 'almost full' };
  }
  if (value >= 70) {
    return { text: 'text-hue-yellow', bar: 'bg-hue-yellow', label: 'filling up' };
  }
  return { text: 'text-hue-green', bar: 'bg-hue-green', label: 'plenty of room' };
}

/** A whole number with thousands separators ("367,800"), without locale methods so the text is the same everywhere. */
export function groupDigits(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Local clock time "HH:MM" of a timestamp. */
export function clockTime(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
