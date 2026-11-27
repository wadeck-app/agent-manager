/**
 * Which chips of the one-line header fit, and what the "+N" tooltip says about the others. Pure: the widths are measured by the caller (useItemFit) on the
 * real row.
 *
 * Priority (most important first); the name, the state and the age are not in the list, they are always on the line. The owned host (Web, Terminal,
 * Background) is in the action icons at the right of the line, not in the line. A chip that does not fit never blocks a narrower, less important one: the
 * old fit dropped chips from the end until the row stopped overflowing, so a folder wider than the free space took everything after it away.
 */
export const LINE_PRIORITY = ['folder', 'context', 'model', 'role', 'harness', 'tokens', 'duration', 'session', 'pid'] as const;

export interface FitInput {
  /** Room for the chips: the width of the line minus the name, the state and the age with their gaps. */
  available: number;
  /** Measured natural width of each chip, by key. A key without a width is never shown. */
  widths: Readonly<Record<string, number>>;
  /** Keys, most important first. */
  order: readonly string[];
  gap: number;
  /** Width of the "+N" chip, reserved as soon as one chip is dropped. */
  moreWidth: number;
}

/** The keys that stay on the line. All of them when they all fit (no "+N" chip); else the best-priority ones that fit next to the "+N" chip. */
export function fitItems({ available, widths, order, gap, moreWidth }: FitInput): ReadonlySet<string> {
  const known = order.filter((key) => widths[key] !== undefined);
  const total = known.reduce((sum, key) => sum + gap + (widths[key] ?? 0), 0);
  if (known.length === order.length && total <= available) {
    return new Set(known);
  }
  let left = available - (gap + moreWidth);
  const kept = new Set<string>();
  for (const key of known) {
    const cost = gap + (widths[key] ?? 0);
    if (cost <= left) {
      kept.add(key);
      left -= cost;
    }
  }
  return kept;
}

/** One fact about a chip: what it is and its value. */
export interface HiddenEntry {
  label: string;
  value: string;
}

/** The entries that have a value, as "label value" (a bare label says nothing and is omitted). */
export function usableEntries(entries: readonly HiddenEntry[]): HiddenEntry[] {
  return entries.filter((entry) => entry.value.trim() !== '');
}

/** "label value; label value" for the tooltip of the "+N" chip. */
export function hiddenSummary(entries: readonly HiddenEntry[]): string {
  return usableEntries(entries)
    .map((entry) => `${entry.label} ${entry.value}`)
    .join('; ');
}

export interface FitRowsInput extends FitInput {
  /** Width of the second row (the whole header, the actions are not on it); 0 or less when it is not known: there is no second row then. */
  secondAvailable: number;
}

export interface FitRows {
  first: ReadonlySet<string>;
  second: ReadonlySet<string>;
}

/**
 * Two rows instead of a "+N" chip right away: the chips after the last one that fits next to the name, the state and the age (the actions share that row) go to a second row
 * as wide as the whole header; only what does not fit there either is left to the "+N" chip, which ends the second row. Without a width for the second row
 * (no layout), it is `fitItems` on the first row alone.
 */
export function fitRows(input: FitRowsInput): FitRows {
  const { available, secondAvailable, widths, order, gap, moreWidth } = input;
  const known = order.filter((key) => widths[key] !== undefined);
  if (secondAvailable <= 0 || (known.length === order.length && known.reduce((sum, key) => sum + gap + (widths[key] ?? 0), 0) <= available)) {
    return { first: fitItems(input), second: new Set() };
  }
  // The first row takes a PREFIX of the order and stops at the first chip that does not fit: the second row continues from there, so the chips read in the
  // same order for every session (a narrow chip never jumps ahead of a wider one to the first row).
  let left = available;
  const first = new Set<string>();
  for (const key of known) {
    const cost = gap + (widths[key] ?? 0);
    if (cost > left) {
      break;
    }
    first.add(key);
    left -= cost;
  }
  const rest = order.filter((key) => !first.has(key));
  // The second row has no leading gap: one gap is given back.
  return { first, second: fitItems({ available: secondAvailable + gap, widths, order: rest, gap, moreWidth }) };
}
