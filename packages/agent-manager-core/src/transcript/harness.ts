import type { HarnessInfo } from './types.js';

/** The tags Claude Code writes itself into user entries (read-only census of real transcripts: command-*, local-command-*, bash-*, system-reminder, task-notification). */
const KNOWN_TAGS: ReadonlySet<string> = new Set([
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'local-command-stderr',
  'local-command-caveat',
  'bash-input',
  'bash-stdout',
  'bash-stderr',
  'system-reminder',
  'task-notification',
]);

/** One element at the start of the text: `<tag attrs>content</tag>`; the tag name is back-referenced so nesting of another tag name is kept inside the content. */
const ELEMENT = /^\s*<([a-z][a-z0-9-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/;

const WORDS = 160;

function oneLineOf(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 3)}...`;
}

/**
 * Whether a user entry is only text Claude Code injected itself, made of the known harness tags and nothing else (not a prompt the person wrote): a slash command
 * (`/compact`, `/clear`), its output, the caveat that goes with it, a `!` shell command and its output, a system reminder. Returns a short readable label, a
 * one-line summary and the inner text. Text with any other content around or inside the tags, or with a tag that is not known, is NOT harness text: it stays a
 * prompt, visible as written (never dropped, never relabelled on a guess). The text is expected without ANSI escapes (see stripAnsi).
 */
export function classifyHarnessText(text: string): HarnessInfo | undefined {
  const parts: { tag: string; content: string }[] = [];
  let rest = text;
  while (rest.trim() !== '') {
    const match = ELEMENT.exec(rest);
    const tag = match?.[1];
    if (match === null || tag === undefined || !KNOWN_TAGS.has(tag)) {
      return undefined;
    }
    parts.push({ tag, content: (match[2] ?? '').trim() });
    rest = rest.slice(match[0].length);
  }
  if (parts.length === 0) {
    return undefined;
  }
  const valueOf = (tag: string): string => parts.find((part) => part.tag === tag)?.content ?? '';
  const tags = [...new Set(parts.map((part) => part.tag))];
  const name = valueOf('command-name');
  if (name !== '' || valueOf('command-message') !== '') {
    const shown = name !== '' ? name : `/${valueOf('command-message')}`;
    const args = valueOf('command-args');
    return { label: `Command ${shown}`, summary: oneLineOf(args === '' ? shown : `${shown} ${args}`, WORDS), detail: args, tags };
  }
  const inner = parts.map((part) => part.content).filter((content) => content !== '').join('\n');
  const first = parts[0]?.tag;
  const error = tags.includes('local-command-stderr') || tags.includes('bash-stderr');
  const label =
    first === 'local-command-stdout' ? 'Command output'
    : first === 'local-command-stderr' ? 'Command error'
    : first === 'local-command-caveat' ? 'Command caveat'
    : first === 'bash-input' ? 'Shell command'
    : first === 'bash-stdout' || first === 'bash-stderr' ? 'Shell output'
    : first === 'task-notification' ? 'Background task finished'
    : 'System reminder';
  return { label, summary: oneLineOf(inner, WORDS), detail: inner, tags, ...(error && inner !== '' ? { level: 'error' as const } : {}) };
}
