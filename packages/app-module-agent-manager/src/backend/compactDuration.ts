const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Shown when the registry gives no statusUpdatedAt: the time in state is unknown, which is not the same as "just now". */
export const UNKNOWN_DURATION = '?';

/**
 * The time spent in the current state, compact like the herdr panel: "<1m", "5m", "1h", "4h", "2d". Each unit is floored, so 59 s is "<1m",
 * 60 s is "1m", 59 min 59 s is "59m", 60 min is "1h", 24 h is "1d". A negative age (clock skew between the registry writer and this
 * process) counts as 0. `undefined` or a non-finite number is "?" (see UNKNOWN_DURATION), never "<1m".
 */
export function compactDuration(ageMs: number | undefined): string {
  if (ageMs === undefined || !Number.isFinite(ageMs)) {
    return UNKNOWN_DURATION;
  }
  const age = Math.max(0, ageMs);
  if (age < MINUTE) {
    return '<1m';
  }
  if (age < HOUR) {
    return `${Math.floor(age / MINUTE)}m`;
  }
  if (age < DAY) {
    return `${Math.floor(age / HOUR)}h`;
  }
  return `${Math.floor(age / DAY)}d`;
}
