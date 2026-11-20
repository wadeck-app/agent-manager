/** One block of the tool input shown to the user: the exact text the decision is made on. */
export interface InputBlock {
  label: string;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A block this long (in lines or characters) is folded to a few lines, with a visible button to open all of it. Nothing is cut: folding is a display state. */
export const FOLD_LINES = 12;
export const FOLD_CHARS = 1200;

export function isLarge(text: string): boolean {
  return text.length > FOLD_CHARS || text.split('\n').length > FOLD_LINES;
}

/**
 * The tool input as blocks to read: a `command` (Bash) is shown as typed, and every other field as pretty JSON. The whole input is always shown, in full:
 * what the user allows is what the agent will run, so no field is dropped. Never HTML: the caller renders it as text.
 */
export function inputBlocks(input: unknown): InputBlock[] {
  if (isRecord(input)) {
    const { command, ...rest } = input;
    if (typeof command !== 'string') {
      return [{ label: 'Input', text: JSON.stringify(input, null, 2) }];
    }
    const blocks: InputBlock[] = [{ label: 'Command', text: command }];
    if (Object.keys(rest).length > 0) {
      blocks.push({ label: 'Other fields', text: JSON.stringify(rest, null, 2) });
    }
    return blocks;
  }
  if (typeof input === 'string') {
    return [{ label: 'Input', text: input }];
  }
  // A non-object, non-string input (null, a number, an array): JSON.stringify is exact for all of them; undefined is said, not hidden.
  return [{ label: 'Input', text: input === undefined ? '(the request carries no input)' : JSON.stringify(input, null, 2) }];
}
