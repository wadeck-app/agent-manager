// ANSI escape sequences: CSI (ESC [ ... final byte), OSC (ESC ] ... BEL or ESC \), and lone two-character escapes.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Removes ANSI escape sequences (colours, cursor moves, hyperlinks) from tool output. */
export function stripAnsi(text: string): string {
  return text.includes('\u001b') ? text.replace(ANSI, '') : text;
}

/** The text cut to at most `max` UTF-16 units, never inside a surrogate pair. */
export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    end -= 1;
  }
  return { text: text.slice(0, end), truncated: true };
}

/** Whitespace (newlines included) collapsed to single spaces, trimmed, cut to `max` characters with "..." when cut. */
export function oneLine(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) {
    return collapsed;
  }
  const cut = truncateText(collapsed, Math.max(0, max - 3)).text;
  return `${cut}...`;
}

/** Decoded size in bytes of a base64 string, without decoding it. */
export function base64Bytes(base64: string): number {
  const len = base64.length;
  if (len === 0) {
    return 0;
  }
  let padding = 0;
  if (base64.charCodeAt(len - 1) === 61) {
    padding++;
    if (len > 1 && base64.charCodeAt(len - 2) === 61) {
      padding++;
    }
  }
  return Math.floor((len * 3) / 4) - padding;
}

/** Epoch ms of an ISO timestamp, undefined when absent or not a date. */
export function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * A JSON-compatible copy of `value` whose serialisation fits `budget` characters: strings are cut, then keys and items beyond the budget (or
 * deeper than 6 levels) are left out. `truncated` tells whether anything was cut or left out.
 */
export function boundValue(value: unknown, budget: number): { value: Record<string, unknown>; truncated: boolean } {
  const state = { left: budget, truncated: false };
  const clone = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      const take = Math.max(0, Math.min(v.length, state.left));
      state.left -= take;
      if (take < v.length) {
        state.truncated = true;
        return truncateText(v, take).text;
      }
      return v;
    }
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      state.left -= 5;
      return v;
    }
    if (depth >= 6) {
      state.truncated = true;
      return null;
    }
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const item of v) {
        if (state.left <= 0) {
          state.truncated = true;
          break;
        }
        out.push(clone(item, depth + 1));
      }
      return out;
    }
    if (isRecord(v)) {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(v)) {
        if (state.left <= 0) {
          state.truncated = true;
          break;
        }
        state.left -= key.length + 4;
        out[key] = clone(item, depth + 1);
      }
      return out;
    }
    return null;
  };
  const root = isRecord(value) ? clone(value, 0) : {};
  return { value: isRecord(root) ? root : {}, truncated: state.truncated };
}
