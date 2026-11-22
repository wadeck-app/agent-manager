import type { ToolMeta } from './types.js';
import { asNumber, asString, isRecord } from './text.js';

/**
 * The meta of a tool call (see ToolMeta): strict readers, a value is set only when the field has the expected type. Two steps: the input at the tool_use
 * line (whole, before it is cut for the entry), then the result line (its text and its `toolUseResult`).
 */

const count = (value: unknown): number | undefined => {
  const n = asNumber(value);
  return n !== undefined && n >= 0 ? n : undefined;
};

/** Lines of a text: 0 for an empty one, a final newline does not start another line. */
export function countLines(text: string): number {
  if (text === '') {
    return 0;
  }
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

const splitLines = (text: string): string[] => (text === '' ? [] : text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n'));

/** Lines removed and added by replacing `before` with `after`, once the lines the two share at the start and at the end are left out. */
export function trimmedChurn(before: string, after: string): { added: number; removed: number } {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) {
    end += 1;
  }
  return { added: b.length - start - end, removed: a.length - start - end };
}

function addChurn(meta: ToolMeta, churn: { added: number; removed: number }): void {
  meta.added = (meta.added ?? 0) + churn.added;
  meta.removed = (meta.removed ?? 0) + churn.removed;
}

/** `mcp__<server>__<tool>`. */
function mcpParts(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) {
    return undefined;
  }
  const rest = name.slice('mcp__'.length);
  const at = rest.indexOf('__');
  return at > 0 && at < rest.length - 2 ? { server: rest.slice(0, at), tool: rest.slice(at + 2) } : undefined;
}

function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    return host === '' ? undefined : host;
  } catch {
    return undefined;
  }
}

function nonEmpty(value: unknown): string | undefined {
  const text = asString(value);
  return text === undefined || text === '' ? undefined : text;
}

function clean(meta: ToolMeta): ToolMeta | undefined {
  return Object.keys(meta).length === 0 ? undefined : meta;
}

/** The meta that the input alone gives (the call may still be running). `input` is the whole input as written, not the cut copy. */
export function metaFromInput(name: string, input: unknown): ToolMeta | undefined {
  const meta: ToolMeta = {};
  const record = isRecord(input) ? input : {};
  const mcp = mcpParts(name);
  if (mcp !== undefined) {
    meta.mcpServer = mcp.server;
    meta.mcpTool = mcp.tool;
  }
  switch (name) {
    case 'Edit': {
      const file = nonEmpty(record.file_path);
      if (file !== undefined) {
        meta.file = file;
      }
      if (typeof record.old_string === 'string' && typeof record.new_string === 'string') {
        addChurn(meta, trimmedChurn(record.old_string, record.new_string));
        meta.churnApprox = true;
      }
      break;
    }
    case 'MultiEdit': {
      const file = nonEmpty(record.file_path);
      if (file !== undefined) {
        meta.file = file;
      }
      if (Array.isArray(record.edits)) {
        meta.edits = record.edits.length;
        let all = record.edits.length > 0;
        for (const edit of record.edits) {
          if (isRecord(edit) && typeof edit.old_string === 'string' && typeof edit.new_string === 'string') {
            addChurn(meta, trimmedChurn(edit.old_string, edit.new_string));
          } else {
            all = false;
          }
        }
        if (all) {
          meta.churnApprox = true;
        } else {
          delete meta.added;
          delete meta.removed;
        }
      }
      break;
    }
    case 'Write': {
      const file = nonEmpty(record.file_path);
      if (file !== undefined) {
        meta.file = file;
      }
      if (typeof record.content === 'string') {
        meta.added = countLines(record.content);
        meta.removed = 0;
        meta.churnApprox = true;
      }
      break;
    }
    case 'Bash': {
      if (record.run_in_background === true) {
        meta.background = true;
      }
      const timeout = count(record.timeout);
      if (timeout !== undefined) {
        meta.timeoutMs = timeout;
      }
      break;
    }
    case 'Read': {
      const file = nonEmpty(record.file_path);
      if (file !== undefined) {
        meta.file = file;
      }
      break;
    }
    case 'WebFetch': {
      const host = typeof record.url === 'string' ? hostOf(record.url) : undefined;
      if (host !== undefined) {
        meta.host = host;
      }
      break;
    }
    case 'Agent':
    case 'Task': {
      const type = nonEmpty(record.subagent_type);
      if (type !== undefined) {
        meta.subagentType = type;
      }
      if (record.run_in_background === true) {
        meta.background = true;
      }
      break;
    }
  }
  return clean(meta);
}

/** The lines of a `structuredPatch`: undefined when it is not an array of hunks with a list of strings (then it is not used at all). */
function patchChurn(patch: unknown): { added: number; removed: number } | undefined {
  if (!Array.isArray(patch)) {
    return undefined;
  }
  let added = 0;
  let removed = 0;
  for (const hunk of patch) {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) {
      return undefined;
    }
    for (const line of hunk.lines) {
      if (typeof line !== 'string') {
        return undefined;
      }
      if (line.startsWith('+')) {
        added += 1;
      } else if (line.startsWith('-')) {
        removed += 1;
      }
    }
  }
  return { added, removed };
}

/**
 * The meta once the result is known. `result` is the `toolUseResult` of the line, passed ONLY when the line holds this call's result alone (undefined
 * otherwise). Returns a new object; the meta of the call is not changed.
 */
export function metaFromResult(name: string, previous: ToolMeta | undefined, text: string, result: unknown, isError: boolean): ToolMeta | undefined {
  const meta: ToolMeta = { ...previous };
  const tur = isRecord(result) ? result : {};
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write': {
      if (isError) {
        delete meta.added;
        delete meta.removed;
        delete meta.churnApprox;
        break;
      }
      const patch = patchChurn(tur.structuredPatch);
      if (name === 'Write' && tur.type === 'create') {
        meta.created = true;
        delete meta.churnApprox;
      } else if (patch !== undefined) {
        meta.added = patch.added;
        meta.removed = patch.removed;
        delete meta.churnApprox;
      } else if (name === 'Write' && tur.type !== undefined) {
        // An overwrite with no usable patch: the input says how long the new file is, not what changed.
        delete meta.added;
        delete meta.removed;
        delete meta.churnApprox;
      }
      break;
    }
    case 'Bash': {
      const exit = isError ? /^Exit code (\d+)\s*$/.exec(text.split('\n', 1)[0] ?? '') : null;
      if (exit !== null) {
        meta.exitCode = Number(exit[1]);
      }
      meta.outputLines = countLines(text);
      if (tur.interrupted === true) {
        meta.interrupted = true;
      }
      const task = nonEmpty(tur.backgroundTaskId);
      if (task !== undefined) {
        meta.backgroundTaskId = task;
      }
      break;
    }
    case 'Read': {
      if (tur.type === 'image') {
        meta.image = true;
      }
      const file = isRecord(tur.file) ? tur.file : {};
      for (const [key, field] of [['numLines', 'readLines'], ['startLine', 'readFrom'], ['totalLines', 'readTotal']] as const) {
        const value = count(file[key]);
        if (value !== undefined) {
          meta[field] = value;
        }
      }
      break;
    }
    case 'Grep': {
      const mode = nonEmpty(tur.mode);
      if (mode !== undefined) {
        meta.mode = mode;
      }
      // numFiles is 0 in content and count mode (observed): it means "files listed", only meaningful in files_with_matches mode.
      const files = mode === 'files_with_matches' ? count(tur.numFiles) : undefined;
      if (files !== undefined) {
        meta.files = files;
      }
      const lines = mode === 'content' ? count(tur.numLines) : undefined;
      if (lines !== undefined) {
        meta.lines = lines;
      }
      const matches = count(tur.numMatches);
      if (matches !== undefined) {
        meta.matches = matches;
      }
      if (count(tur.appliedLimit) !== undefined) {
        meta.limited = true;
      }
      break;
    }
    case 'Glob': {
      const files = count(tur.numFiles);
      if (files !== undefined) {
        meta.files = files;
      }
      if (tur.truncated === true) {
        meta.truncated = true;
      }
      break;
    }
    case 'WebFetch': {
      const code = count(tur.code);
      if (code !== undefined) {
        meta.httpCode = code;
      }
      const bytes = count(tur.bytes);
      if (bytes !== undefined) {
        meta.fetchedBytes = bytes;
      }
      break;
    }
  }
  return clean(meta);
}
