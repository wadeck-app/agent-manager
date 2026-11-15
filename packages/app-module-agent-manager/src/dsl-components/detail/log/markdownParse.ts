/**
 * A small markdown parser for assistant text. It produces DATA (blocks and inline nodes), never markup: the renderer builds React elements from it, so
 * raw HTML in the text ends up as plain text, and nothing here can create a script, an image or an attribute from the text.
 */

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'strong'; children: Inline[] }
  | { t: 'em'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] }
  /** An image is NOT loaded: shown as its alt text. */
  | { t: 'image'; alt: string };

export interface ListItem {
  inline: Inline[];
  children: Block[];
}

export type Block =
  | { t: 'p'; inline: Inline[] }
  | { t: 'h'; level: number; inline: Inline[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'list'; ordered: boolean; items: ListItem[] }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'hr' }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

/** Only web and mail links are clickable: a `javascript:`, `data:` or `file:` target is shown as text. */
export function safeHref(raw: string): string | undefined {
  const href = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(href)) {
    return undefined;
  }
  return /^(https?:\/\/|mailto:)[^\s]+$/i.test(href) ? href : undefined;
}

const INLINE =
  /(?<code>`+)(?<codeText>[^`]|[^`][\s\S]*?[^`])\k<code>(?!`)|!\[(?<alt>[^\]]*)\]\((?<imgUrl>[^)\s]*)[^)]*\)|\[(?<label>[^\]]+)\]\((?<url>[^)\s]+)(?:\s+"[^"]*")?\)|\*\*(?<bold>[^*]+?)\*\*|(?<![\w_])__(?<bold2>[^_]+?)__(?![\w_])|(?<![\w*])\*(?<em>[^*\s][^*]*?)\*(?![\w*])|(?<![\w_])_(?<em2>[^_\s][^_]*?)_(?![\w_])|(?<bare>https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"])/gu;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (value: string): void => {
    if (value !== '') {
      out.push({ t: 'text', text: value });
    }
  };
  for (const match of text.matchAll(INLINE)) {
    const g = match.groups ?? {};
    push(text.slice(last, match.index));
    last = (match.index ?? 0) + match[0].length;
    if (g['codeText'] !== undefined) {
      out.push({ t: 'code', text: g['codeText'].trim() });
    } else if (g['alt'] !== undefined) {
      out.push({ t: 'image', alt: g['alt'] });
    } else if (g['label'] !== undefined) {
      const href = safeHref(g['url'] ?? '');
      if (href === undefined) {
        // Not a safe target: the label stays, the address is shown so nothing is hidden.
        push(`${g['label']} (${g['url'] ?? ''})`);
      } else {
        out.push({ t: 'link', href, children: parseInline(g['label']) });
      }
    } else if (g['bold'] !== undefined || g['bold2'] !== undefined) {
      out.push({ t: 'strong', children: parseInline(g['bold'] ?? g['bold2'] ?? '') });
    } else if (g['em'] !== undefined || g['em2'] !== undefined) {
      out.push({ t: 'em', children: parseInline(g['em'] ?? g['em2'] ?? '') });
    } else if (g['bare'] !== undefined) {
      const href = safeHref(g['bare']);
      out.push(href === undefined ? { t: 'text', text: g['bare'] } : { t: 'link', href, children: [{ t: 'text', text: g['bare'] }] });
    }
  }
  push(text.slice(last));
  return out;
}

const LIST_LINE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

const isTableSeparator = (line: string): boolean => line.includes('-') && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = LIST_LINE.exec(lines[start]!)!;
  const baseIndent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const match = LIST_LINE.exec(lines[i]!);
    if (match === null || match[1]!.length !== baseIndent) {
      break;
    }
    const textLines = [match[3]!];
    const children: Block[] = [];
    i += 1;
    while (i < lines.length && lines[i]!.trim() !== '') {
      const nested = LIST_LINE.exec(lines[i]!);
      if (nested !== null && nested[1]!.length > baseIndent) {
        const sub = parseList(lines, i);
        children.push(sub.block);
        i = sub.next;
      } else if (nested === null && lines[i]!.search(/\S/) > baseIndent) {
        textLines.push(lines[i]!.trim());
        i += 1;
      } else {
        break;
      }
    }
    items.push({ inline: parseInline(textLines.join('\n')), children });
  }
  return { block: { t: 'list', ordered, items }, next: i };
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ t: 'p', inline: parseInline(paragraph.join('\n')) });
      paragraph = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence !== null) {
      flush();
      const marker = fence[1]!;
      const body: string[] = [];
      i += 1;
      // An unclosed fence runs to the end of the text (a message cut by the size limit).
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1;
      blocks.push({ t: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flush();
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ t: 'h', level: heading[1]!.length, inline: parseInline(heading[2]!) });
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ t: 'hr' });
      i += 1;
      continue;
    }
    if (line.startsWith('>')) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        quoted.push(lines[i]!.replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ t: 'quote', blocks: parseBlocks(quoted.join('\n')) });
      continue;
    }
    if (LIST_LINE.test(line)) {
      flush();
      const list = parseList(lines, i);
      blocks.push(list.block);
      i = list.next;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      flush();
      const head = cells(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push(cells(lines[i]!).map(parseInline));
        i += 1;
      }
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    paragraph.push(line);
    i += 1;
  }
  flush();
  return blocks;
}
