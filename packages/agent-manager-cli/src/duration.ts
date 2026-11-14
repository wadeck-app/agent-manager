/** A duration the user typed is invalid. The message says what was wrong and what is accepted. */
export class DurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DurationError';
  }
}

const UNIT_MS = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 } as const;
type Unit = keyof typeof UNIT_MS;

const ACCEPTED = "accepted: '0' (no timeout), or a number then a unit among d h m s, e.g. 30s, 15m, 5h, 1d, 1h5m30s";

function fail(input: string, reason: string): never {
  throw new DurationError(`invalid duration '${input}': ${reason} (${ACCEPTED})`);
}

/**
 * Parses a duration such as `30s`, `15m`, `5h`, `1d` or `1h5m30s` into milliseconds.
 * `0` means "no timeout" and is the only number accepted without a unit. The documented form lists the units in descending order,
 * any order is accepted; a unit given twice, a sign, a decimal, a space or an unknown unit is rejected.
 */
export function parseDuration(input: string): number {
  const text = input.trim();
  if (text === '') {
    fail(input, 'it is empty');
  }
  if (text === '0') {
    return 0;
  }
  if (text.startsWith('-')) {
    fail(input, 'a duration cannot be negative');
  }
  if (/^\d+$/.test(text)) {
    fail(input, `'${text}' has no unit, add one (e.g. ${text}s for seconds)`);
  }
  const seen = new Set<Unit>();
  let total = 0;
  let position = 0;
  const part = /(\d+)([^\d]?)/y;
  while (position < text.length) {
    part.lastIndex = position;
    const match = part.exec(text);
    if (match === null) {
      fail(input, `expected a number at '${text.slice(position)}'`);
    }
    const [whole, digits, unit] = match as unknown as [string, string, string];
    if (unit === '') {
      fail(input, `the number ${digits} at the end has no unit`);
    }
    if (!(unit in UNIT_MS)) {
      fail(input, `unknown unit '${unit}' after ${digits}`);
    }
    const known = unit as Unit;
    if (seen.has(known)) {
      fail(input, `the unit '${known}' is given twice`);
    }
    seen.add(known);
    total += Number(digits) * UNIT_MS[known];
    position += whole.length;
  }
  if (!Number.isSafeInteger(total)) {
    fail(input, 'it is too large');
  }
  return total;
}
