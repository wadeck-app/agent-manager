/** "<1m", "3m", "44m", "7h", "2d": the compact time in state of the herdr panel. Never negative, never longer than 3 characters. */
export function compactDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '';
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return '<1m';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

/** The time a session has spent in its state, compact; empty when the registry gave no time. */
export function timeInState(statusUpdatedAt: number | undefined, now: number): string {
  return statusUpdatedAt === undefined ? '' : compactDuration(now - statusUpdatedAt);
}

/** The full sentence for a tooltip: "In this state for 3 minutes (since 14:02)". */
export function describeTimeInState(statusUpdatedAt: number | undefined, now: number): string {
  if (statusUpdatedAt === undefined) {
    return 'The registry gives no time for this status';
  }
  const seconds = Math.max(0, Math.floor((now - statusUpdatedAt) / 1000));
  const amount = seconds < 60 ? `${seconds} s` : seconds < 3600 ? `${Math.floor(seconds / 60)} min` : seconds < 86_400 ? `${Math.floor(seconds / 3600)} h` : `${Math.floor(seconds / 86_400)} d`;
  return `In this state for ${amount}`;
}
