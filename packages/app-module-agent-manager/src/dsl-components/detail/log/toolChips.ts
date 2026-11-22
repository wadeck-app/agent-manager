import { formatBytes, formatDuration } from './format.js';
import type { ToolCall } from './grouping.js';

/** Colour is for these meanings only: lines added, lines removed, a failure, something worth a look. */
export type ChipTone = 'add' | 'remove' | 'fail' | 'warn';
export interface ChipPart {
  text: string;
  tone?: ChipTone;
}
export interface MetaChip {
  id: string;
  /** The visible pieces (tabular numbers, colour only on the signs and failures). */
  parts: ChipPart[];
  /** The same in words: the accessible name and the tooltip. */
  label: string;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const part = (text: string, tone?: ChipTone): ChipPart => (tone === undefined ? { text } : { text, tone });
const plain = (id: string, text: string, label = text): MetaChip => ({ id, parts: [part(text)], label });

/** The name shown on a row: the tool of an MCP call (the server is a chip), else the name of the tool. */
export function toolLabel(call: ToolCall): string {
  return call.meta?.mcpTool ?? call.name;
}

function churnChip(id: string, added: number, removed: number, approx: boolean, prefix = ''): MetaChip {
  const words = `${plural(added, 'line')} added, ${plural(removed, 'line')} removed`;
  return {
    id,
    parts: [...(approx ? [part('~')] : []), part(`${prefix}+${added}`, 'add'), part(`-${removed}`, 'remove')],
    label: approx ? `About ${words} (an estimate from the edit: the result gives no diff yet)` : words,
  };
}

/** Compact facts of one tool call, from `meta` only: a fact the transcript does not give is not shown (never 0). */
export function callChips(call: ToolCall): MetaChip[] {
  const meta = call.meta;
  if (meta === undefined) {
    return [];
  }
  const chips: MetaChip[] = [];
  switch (call.name) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write': {
      if (meta.added !== undefined && meta.removed !== undefined) {
        chips.push(churnChip('churn', meta.added, meta.removed, meta.churnApprox === true));
      }
      if (meta.created === true) {
        chips.push(plain('new', 'new', 'New file'));
      }
      if (meta.edits !== undefined && meta.edits > 1) {
        chips.push(plain('edits', `${meta.edits} edits`));
      }
      break;
    }
    case 'Bash': {
      if (meta.background === true) {
        chips.push(plain('bg', 'bg', 'Started in the background'));
      }
      if (meta.exitCode !== undefined) {
        chips.push({ id: 'exit', parts: [part(`exit ${meta.exitCode}`, 'fail')], label: `Exit code ${meta.exitCode}` });
      }
      if (meta.interrupted === true) {
        chips.push({ id: 'interrupted', parts: [part('interrupted', 'warn')], label: 'Interrupted before it ended' });
      }
      // The result of a background call is the launch message: its lines are not the output.
      if (meta.background !== true && meta.outputLines !== undefined && meta.outputLines > 0) {
        chips.push(plain('output', plural(meta.outputLines, 'line'), `Output: ${plural(meta.outputLines, 'line')}${call.resultBytes === undefined ? '' : `, ${formatBytes(call.resultBytes)}`}`));
      }
      break;
    }
    case 'Read': {
      if (meta.image === true) {
        chips.push(plain('image', 'image', 'An image'));
      } else if (meta.readLines !== undefined) {
        const from = meta.readFrom ?? 1;
        const whole = from === 1 && meta.readTotal !== undefined && meta.readLines === meta.readTotal;
        if (whole || meta.readTotal === undefined) {
          chips.push(plain('range', plural(meta.readLines, 'line'), `Read ${plural(meta.readLines, 'line')}${meta.readFrom === undefined ? '' : ` from line ${meta.readFrom}`}`));
        } else {
          chips.push(plain('range', `${from}-${from + meta.readLines - 1} of ${meta.readTotal}`, `Read lines ${from} to ${from + meta.readLines - 1} of ${meta.readTotal}`));
        }
      }
      break;
    }
    case 'Grep':
    case 'Glob': {
      if (meta.files !== undefined) {
        chips.push(plain('found', plural(meta.files, 'file'), `Found in ${plural(meta.files, 'file')}`));
      } else if (meta.lines !== undefined) {
        chips.push(plain('found', plural(meta.lines, 'line'), `${plural(meta.lines, 'line')} of output (matches and their context)`));
      } else if (meta.matches !== undefined) {
        chips.push(plain('found', plural(meta.matches, 'match', 'matches'), plural(meta.matches, 'match', 'matches')));
      }
      if (meta.limited === true || meta.truncated === true) {
        chips.push(plain('cut', 'cut', 'The answer was cut at its limit'));
      }
      break;
    }
    case 'WebFetch': {
      if (meta.host !== undefined) {
        chips.push(plain('host', meta.host, `Fetched from ${meta.host}`));
      }
      if (meta.httpCode !== undefined) {
        chips.push({ id: 'status', parts: [part(String(meta.httpCode), meta.httpCode >= 400 ? 'fail' : undefined)], label: `HTTP status ${meta.httpCode}` });
      }
      if (meta.fetchedBytes !== undefined) {
        chips.push(plain('size', formatBytes(meta.fetchedBytes), `Page of ${formatBytes(meta.fetchedBytes)}`));
      }
      break;
    }
    case 'Agent':
    case 'Task': {
      if (meta.subagentType !== undefined) {
        chips.push(plain('type', meta.subagentType, `Sub-agent type ${meta.subagentType}`));
      }
      if (meta.background === true) {
        chips.push(plain('bg', 'bg', 'Started in the background'));
      }
      break;
    }
  }
  if (meta.mcpServer !== undefined) {
    chips.push(plain('mcp', `mcp ${meta.mcpServer}`, `MCP server ${meta.mcpServer}`));
  }
  return chips;
}

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write']);

/** Totals of a group of calls (a tool with nothing to total adds no chip): a total that one call cannot give is left out, not summed short. */
export function groupChips(calls: readonly ToolCall[]): MetaChip[] {
  const chips: MetaChip[] = [];
  // Edits. A failed edit applied nothing: it is not in the totals.
  const edits = calls.filter((call) => EDIT_TOOLS.has(call.name) && call.status !== 'error');
  if (edits.length > 0) {
    const files = new Set(edits.flatMap((call) => (call.meta?.file === undefined ? [] : [call.meta.file])));
    const counted = edits.every((call) => call.meta?.added !== undefined && call.meta.removed !== undefined);
    const filesText = files.size === 0 ? '' : plural(files.size, 'file');
    if (counted) {
      const added = edits.reduce((sum, call) => sum + (call.meta?.added ?? 0), 0);
      const removed = edits.reduce((sum, call) => sum + (call.meta?.removed ?? 0), 0);
      const approx = edits.some((call) => call.meta?.churnApprox === true);
      const words = `${plural(added, 'line')} added, ${plural(removed, 'line')} removed`;
      chips.push({
        id: 'edits',
        parts: [...(approx ? [part('~')] : []), ...(filesText === '' ? [] : [part(filesText)]), part(`+${added}`, 'add'), part(`-${removed}`, 'remove')],
        label: `${filesText === '' ? 'Edits' : `${filesText} changed`}: ${approx ? 'about ' : ''}${words}${approx ? ' (an estimate for the edits still running)' : ''}`,
      });
    } else if (filesText !== '') {
      chips.push(plain('edits', filesText, `${filesText} changed (the line counts are not known for every edit)`));
    }
  }
  const bash = calls.filter((call) => call.name === 'Bash');
  if (bash.length > 0) {
    const known = bash.every((call) => call.durationMs !== undefined);
    const total = bash.reduce((sum, call) => sum + (call.durationMs ?? 0), 0);
    const text = `${bash.length} bash${known ? ` ${formatDuration(total)}` : ''}`;
    chips.push(plain('bash', text, known ? `${plural(bash.length, 'Bash call')}, ${formatDuration(total)} in total` : `${plural(bash.length, 'Bash call')} (the time of one is not known yet)`));
  }
  const reads = calls.filter((call) => call.name === 'Read');
  if (reads.length > 0) {
    const known = reads.every((call) => call.meta?.readLines !== undefined);
    const total = reads.reduce((sum, call) => sum + (call.meta?.readLines ?? 0), 0);
    chips.push(plain('reads', `${plural(reads.length, 'read')}${known ? ` ${plural(total, 'line')}` : ''}`, known ? `${plural(reads.length, 'Read call')}, ${plural(total, 'line')} in total` : plural(reads.length, 'Read call')));
  }
  return chips;
}

const TOOLTIP_LINES = 20;

/** One line per call (name, what it does, its facts and its time), at most TOOLTIP_LINES: for the title of a group row. */
export function groupTooltip(calls: readonly ToolCall[]): string {
  const lines = calls.slice(0, TOOLTIP_LINES).map((call) => {
    const facts = [...callChips(call).map((chip) => chip.parts.map((p) => p.text).join(' ')), ...(call.durationMs === undefined ? [] : [formatDuration(call.durationMs)])];
    return `${[toolLabel(call), call.inputSummary].filter((text) => text !== '').join(' ')}${facts.length === 0 ? '' : `: ${facts.join(', ')}`}`;
  });
  if (calls.length > TOOLTIP_LINES) {
    lines.push(`... and ${calls.length - TOOLTIP_LINES} more`);
  }
  return lines.join('\n');
}
