export interface Dispatch {
  /** Full command name (`start`, `cli update`), undefined when the words do not form a known command. */
  name: string | undefined;
  /** The bare words that were read as the command (none when argv has only options). */
  words: string[];
  /** argv without those words, order kept. */
  rest: string[];
}

/**
 * Finds the command in argv wherever the options are: the command words are the first bare tokens, skipping options.
 * A group word (`cli`) needs a second word (`update`).
 */
export function splitCommand(argv: readonly string[], names: readonly string[]): Dispatch {
  const consumed: number[] = [];
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      break;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    words.push(arg);
    consumed.push(i);
    const candidate = words.join(' ');
    const isGroup = words.length === 1 && names.some((name) => name.startsWith(`${candidate} `));
    if (isGroup) {
      continue;
    }
    break;
  }
  const name = names.includes(words.join(' ')) ? words.join(' ') : undefined;
  return { name, words, rest: argv.filter((_, i) => !consumed.includes(i)) };
}
