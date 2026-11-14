import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getErrorMessage } from '../errors.js';
import { isRecord, asNumber, asString } from './text.js';
import { TranscriptTailer, type TailerOptions } from './tailer.js';
import type { Entry, ReadNewResult, ReadOptions, SubagentInfo, SubagentNode, TailerState } from './types.js';

/** A meta file larger than this is not read (real ones are a few hundred bytes). */
const MAX_META_BYTES = 256 * 1024;

/** Bytes read of a sub-agent transcript to see whether it starts with a fork-context-ref line. */
const FIRST_LINE_BYTES = 4096;

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
      ...(asNumber(meta.spawnDepth) !== undefined ? { spawnDepth: asNumber(meta.spawnDepth) } : {}),
      isFork: meta.isFork === true || agentType === 'fork',
      ...(asString(meta.model) !== undefined ? { model: asString(meta.model) } : {}),
      ...(asString(meta.requestShape) !== undefined ? { requestShape: asString(meta.requestShape) } : {}),
      transcriptPath,
      metaPath,
    };
    const ref = await readForkRef(transcriptPath);
    if (ref !== undefined) {
      Object.assign(info, ref);
    }
    return { info };
  } catch (error) {
    return { problem: { file, reason: getErrorMessage(error) } };
  }
}

/** The fork-context-ref of the first line of a sub-agent transcript, when there is one (undefined: other first line, or no transcript yet). */
async function readForkRef(path: string): Promise<Pick<SubagentInfo, 'parentSessionId' | 'parentLastUuid' | 'contextLength'> | undefined> {
  let fh;
  try {
    fh = await open(path, 'r');
  } catch {
    return undefined;
  }
  try {
    const buf = Buffer.allocUnsafe(FIRST_LINE_BYTES);
    const { bytesRead } = await fh.read(buf, 0, FIRST_LINE_BYTES, 0);
    const text = buf.toString('utf8', 0, bytesRead);
    if (!text.startsWith('{"type":"fork-context-ref"')) {
      return undefined;
    }
    const nl = text.indexOf('\n');
    const line = nl < 0 ? text : text.slice(0, nl);
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) {
      return undefined;
    }
    return {
      ...(asString(parsed.parentSessionId) !== undefined ? { parentSessionId: asString(parsed.parentSessionId) } : {}),
      ...(asString(parsed.parentLastUuid) !== undefined ? { parentLastUuid: asString(parsed.parentLastUuid) } : {}),
      ...(asNumber(parsed.contextLength) !== undefined ? { contextLength: asNumber(parsed.contextLength) } : {}),
    };
  } catch {
    // A first line cut or malformed: the sub-agent is still listed, without the fork reference.
    return undefined;
  } finally {
    await fh.close().catch(() => undefined);
  }
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
