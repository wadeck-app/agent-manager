import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getErrorMessage } from '../errors.js';
import { isRecord, asNumber, asString } from './text.js';
import { TranscriptTailer, type TailerOptions } from './tailer.js';
import type { Entry, ReadNewResult, ReadOptions, SubagentInfo, SubagentNode, TailerState } from './types.js';

/** A meta file larger than this is not read (real ones are a few hundred bytes). */
const MAX_META_BYTES = 256 * 1024;

/** Bytes read of a sub-agent transcript: its first lines (a fork-context-ref line, then the first line with a timestamp). */
const HEAD_BYTES = 16 * 1024;

export type SubagentFileProblem = { file: string; reason: string };

export type ListSubagentsResult =
  | {
      ok: true;
      /** `<projectDir>/<sessionId>/subagents`. */
      dir: string;
      /** False when the folder does not exist (the session never started a sub-agent): `subagents` is then empty, on purpose and visibly. */
      present: boolean;
      subagents: SubagentInfo[];
      /** Meta files that could not be read: shown, never dropped silently. */
      unreadable: SubagentFileProblem[];
    }
  | { ok: false; error: { code: 'unreadable-dir'; message: string; fix: string } };

/**
 * The sub-agents of a session, from `<projectDir>/<sessionId>/subagents/agent-<id>.meta.json` (+ the first line of `agent-<id>.jsonl` for a fork).
 * `projectDir` is the `projectDir` returned by transcriptPath(). Sorted by agent id. Other files of the folder (`*.forked-skill.json`) are ignored.
 */
export async function listSubagents(projectDir: string, sessionId: string): Promise<ListSubagentsResult> {
  const dir = join(projectDir, sessionId, 'subagents');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { ok: true, dir, present: false, subagents: [], unreadable: [] };
    }
    return {
      ok: false,
      error: { code: 'unreadable-dir', message: `The sub-agents folder cannot be read (${code ?? 'error'}): ${dir}`, fix: 'Check the permissions of the folder, then retry.' },
    };
  }
  const metaFiles = names.filter(n => /^agent-[A-Za-z0-9_-]+\.meta\.json$/.test(n)).sort();
  const subagents: SubagentInfo[] = [];
  const unreadable: SubagentFileProblem[] = [];
  for (let i = 0; i < metaFiles.length; i += 16) {
    const batch = await Promise.all(metaFiles.slice(i, i + 16).map(file => readMeta(dir, file)));
    for (const item of batch) {
      if ('info' in item) {
        subagents.push(item.info);
      } else {
        unreadable.push(item.problem);
      }
    }
  }
  return { ok: true, dir, present: true, subagents, unreadable };
}

async function readMeta(dir: string, file: string): Promise<{ info: SubagentInfo } | { problem: SubagentFileProblem }> {
  const metaPath = join(dir, file);
  const agentId = file.slice('agent-'.length, -'.meta.json'.length);
  try {
    const size = (await stat(metaPath)).size;
    if (size > MAX_META_BYTES) {
      return { problem: { file, reason: `meta file is ${size} bytes, more than ${MAX_META_BYTES}` } };
    }
    const meta: unknown = JSON.parse(await readFile(metaPath, 'utf8'));
    if (!isRecord(meta)) {
      return { problem: { file, reason: 'meta file is not a JSON object' } };
    }
    const transcriptPath = join(dir, `agent-${agentId}.jsonl`);
    const agentType = asString(meta.agentType);
    const info: SubagentInfo = {
      agentId,
      ...(agentType !== undefined ? { agentType } : {}),
      ...(asString(meta.description) !== undefined ? { description: asString(meta.description) } : {}),
      ...(asString(meta.toolUseId) !== undefined ? { toolUseId: asString(meta.toolUseId) } : {}),
      ...(asString(meta.name) !== undefined ? { name: asString(meta.name) } : {}),
      finished: meta.finished === true,
      stoppedByUser: meta.stoppedByUser === true,
      ...(asNumber(meta.spawnDepth) !== undefined ? { spawnDepth: asNumber(meta.spawnDepth) } : {}),
      isFork: meta.isFork === true || agentType === 'fork',
      ...(asString(meta.model) !== undefined ? { model: asString(meta.model) } : {}),
      ...(asString(meta.requestShape) !== undefined ? { requestShape: asString(meta.requestShape) } : {}),
      transcriptPath,
      metaPath,
    };
    const head = await readTranscriptHead(transcriptPath);
    if (head !== undefined) {
      Object.assign(info, head);
    }
    return { info };
  } catch (error) {
    return { problem: { file, reason: getErrorMessage(error) } };
  }
}

type HeadFields = Pick<SubagentInfo, 'parentSessionId' | 'parentLastUuid' | 'contextLength' | 'startedAt' | 'lastWriteAt' | 'readError'>;

/** What the head of a transcript said once: immutable when it came from a timestamped line (the file only grows at its end). */
interface HeadCacheEntry {
  size: number;
  mtimeMs: number;
  /** The start came from a timestamp line: the head can never change, whatever the file does after. */
  settled: boolean;
  fields: Omit<HeadFields, 'lastWriteAt' | 'readError'>;
}

/** Bound of the cache of heads (one entry per sub-agent transcript seen): the oldest entries go first. */
export const HEAD_CACHE_LIMIT = 2000;
const headCache = new Map<string, HeadCacheEntry>();

/** For tests: empties the cache of heads. */
export function clearHeadCache(): void {
  headCache.clear();
}

/** For tests: how many heads are cached. */
export function headCacheSize(): number {
  return headCache.size;
}

function remember(path: string, entry: HeadCacheEntry): void {
  headCache.delete(path);
  headCache.set(path, entry);
  while (headCache.size > HEAD_CACHE_LIMIT) {
    const oldest = headCache.keys().next();
    if (oldest.done === true) {
      break;
    }
    headCache.delete(oldest.value);
  }
}

/**
 * What the first bytes and the file times of a sub-agent transcript say (undefined: no transcript yet): the fork-context-ref of the first line when there is
 * one, the start time (first line with a `timestamp` among the lines that fit in HEAD_BYTES, else the creation time of the file) and the last write time.
 * The last write time comes from one stat on every call (the sub-agent is polled); the head is read and parsed once, then cached per path: it is immutable once a
 * timestamp was found. Without a timestamp it is read again only when the size or the modification time changed. A read error that is not "no such file" is
 * returned as `readError` (never swallowed: the status of that sub-agent is then unknown, not "just started").
 */
async function readTranscriptHead(path: string): Promise<HeadFields | undefined> {
  let fh;
  try {
    fh = await open(path, 'r');
  } catch (error) {
    return isNoSuchFile(error) ? undefined : { readError: `The transcript could not be opened: ${getErrorMessage(error)}` };
  }
  try {
    const stats = await fh.stat();
    const lastWriteAt = Math.round(stats.mtimeMs);
    const cached = headCache.get(path);
    if (cached !== undefined && (cached.settled || (cached.size === stats.size && cached.mtimeMs === stats.mtimeMs))) {
      return { ...cached.fields, lastWriteAt };
    }
    const buf = Buffer.allocUnsafe(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    const text = buf.toString('utf8', 0, bytesRead);
    // Only whole lines: the last one is cut when the file goes on after the window and the window does not end on a line break.
    const lines = text.split('\n');
    if (stats.size > bytesRead && buf[bytesRead - 1] !== 0x0a) {
      lines.pop();
    }
    const fields: HeadCacheEntry['fields'] = {};
    let startedAt: number | undefined;
    for (const line of lines) {
      if (line === '') {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // A line that is not JSON (cut, malformed): the sub-agent is still listed, without what that line would have said.
        continue;
      }
      if (!isRecord(parsed)) {
        continue;
      }
      if (parsed.type === 'fork-context-ref') {
        Object.assign(fields, {
          ...(asString(parsed.parentSessionId) !== undefined ? { parentSessionId: asString(parsed.parentSessionId) } : {}),
          ...(asString(parsed.parentLastUuid) !== undefined ? { parentLastUuid: asString(parsed.parentLastUuid) } : {}),
          ...(asNumber(parsed.contextLength) !== undefined ? { contextLength: asNumber(parsed.contextLength) } : {}),
        });
      }
      const stamp = asString(parsed.timestamp);
      if (stamp !== undefined && startedAt === undefined) {
        const time = Date.parse(stamp);
        if (Number.isFinite(time)) {
          startedAt = time;
        }
      }
      if (startedAt !== undefined) {
        break;
      }
    }
    // No timestamp in the head (a first line longer than the window): the creation time of the file is the best true thing known; 0 means the file system has none.
    fields.startedAt = startedAt ?? (stats.birthtimeMs > 0 ? Math.round(stats.birthtimeMs) : undefined);
    remember(path, { size: stats.size, mtimeMs: stats.mtimeMs, settled: startedAt !== undefined, fields });
    return { ...fields, lastWriteAt };
  } catch (error) {
    return { readError: `The transcript could not be read: ${getErrorMessage(error)}` };
  } finally {
    await fh.close().catch(() => undefined);
  }
}

function isNoSuchFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

/** Tool names under which a parent spawns a sub-agent (observed: Agent; Task is the older name, UNVERIFIED on 2.1.3xx). */
const SPAWN_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task']);

/**
 * tool_use id of every spawning tool call of `entries` -> the agent whose transcript holds the call (undefined: the main session). Feed it with the
 * entries of the main transcript and of each sub-agent transcript (their `ownerAgentId` tells the owner), then pass the map to buildAgentTree().
 */
export function agentCallOwners(entries: Iterable<Entry>, into: Map<string, string | undefined> = new Map()): Map<string, string | undefined> {
  for (const entry of entries) {
    if (entry.kind === 'tool-call' && SPAWN_TOOLS.has(entry.name)) {
      into.set(entry.id, entry.ownerAgentId);
    }
  }
  return into;
}

/**
 * The tree of sub-agents. A sub-agent is the child of the agent that owns the Agent tool call with its `toolUseId` (see agentCallOwners); without
 * that information, or when the owner is the main session or unknown, it is a root. Nested spawns (spawnDepth > 1) are UNVERIFIED on real data.
 */
export function buildAgentTree(subagents: readonly SubagentInfo[], owners: ReadonlyMap<string, string | undefined> = new Map()): SubagentNode[] {
  const nodes = new Map<string, SubagentNode>();
  for (const info of subagents) {
    nodes.set(info.agentId, { info, children: [] });
  }
  const parentOf = (info: SubagentInfo): string | undefined => {
    const owner = info.toolUseId === undefined ? undefined : owners.get(info.toolUseId);
    return owner !== undefined && owner !== info.agentId && nodes.has(owner) ? owner : undefined;
  };
  const roots: SubagentNode[] = [];
  for (const node of nodes.values()) {
    const direct = parentOf(node.info);
    // A parent chain that comes back to the node (a corrupt map) makes it a root instead of a loop.
    let cyclic = false;
    const seen = new Set<string>([node.info.agentId]);
    for (let up = direct; up !== undefined; up = parentOf(nodes.get(up)!.info)) {
      if (seen.has(up)) {
        cyclic = true;
        break;
      }
      seen.add(up);
    }
    if (direct !== undefined && !cyclic) {
      node.parentAgentId = direct;
      nodes.get(direct)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * Sets `subagentId` on the spawning tool calls: matched by the `toolUseId` of a sub-agent meta, else by the `agentId` the result of the call gave.
 * Pure: returns a new array, only the changed entries are new objects.
 */
export function linkSubagents(entries: readonly Entry[], subagents: readonly SubagentInfo[]): Entry[] {
  const byToolUse = new Map<string, string>();
  const known = new Set<string>();
  for (const info of subagents) {
    known.add(info.agentId);
    if (info.toolUseId !== undefined) {
      byToolUse.set(info.toolUseId, info.agentId);
    }
  }
  return entries.map(entry => {
    if (entry.kind !== 'tool-call') {
      return entry;
    }
    const matched = byToolUse.get(entry.id) ?? (entry.agentId !== undefined && known.has(entry.agentId) ? entry.agentId : undefined);
    return matched !== undefined && matched !== entry.subagentId ? { ...entry, subagentId: matched } : entry;
  });
}

/** Tails `agent-<id>.jsonl` of a sub-agent with the same machinery (and the same state type) as the main transcript. */
export class SubagentTailer {
  private readonly tailer: TranscriptTailer;

  constructor(
    readonly info: SubagentInfo,
    options: Omit<TailerOptions, 'agentId'> = {},
  ) {
    this.tailer = new TranscriptTailer({ ...options, agentId: info.agentId });
  }

  /** Same contract as TranscriptTailer.readNew; entries carry `ownerAgentId`. A transcript not written yet is a `missing` error with retry. */
  readNew(state?: TailerState, options?: ReadOptions): Promise<ReadNewResult> {
    return this.tailer.readNew(this.info.transcriptPath, state, options);
  }
}
