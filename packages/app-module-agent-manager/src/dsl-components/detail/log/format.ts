/** "just now", "12s ago", "5m ago", "3h ago", "2d ago". Never negative. */
export function relativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) {
    return 'just now';
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

/** "340 ms", "3.2 s", "1 m 5 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} m ${Math.round((ms % 60_000) / 1000)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** The first non-empty line of a text, cut to `max` characters (the one-line summary of a message). */
export function firstLine(text: string, max = 160): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim() !== '') ?? '';
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}...` : trimmed;
}

/** Cuts a long output: at most `maxLines` lines and `maxChars` characters. `cut` tells whether something was left out. */
export function capOutput(text: string, maxChars: number, maxLines: number): { text: string; cut: boolean; hiddenChars: number } {
  const lines = text.split('\n');
  let shown = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : text;
  if (shown.length > maxChars) {
    shown = shown.slice(0, maxChars);
  }
  return { text: shown, cut: shown.length < text.length, hiddenChars: text.length - shown.length };
}
