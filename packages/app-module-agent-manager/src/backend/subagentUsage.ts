import { stat } from 'node:fs/promises';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import { createTailerState, ModelUsageAccumulator, TranscriptTailer, type TailerState } from '@wadeck-app/agent-manager-core/transcript';
import type { SubagentUsageDto } from '../commons/api.js';
import { usageStatus } from './sessionStatus.js';

/**
 * The model, tokens and context share of ONE sub-agent, from its own transcript (`agent-<id>.jsonl`, same format as the main one: research/subagent-usage-in-transcripts.md).
 * The figures are the ones of the session header (usageStatus over a ModelUsageAccumulator), not another formula. Read incrementally: per transcript the offset of the
 * last complete line and the folded counters are kept, so an unchanged file costs one stat per poll and a growing one only its new bytes.
 */

/** Transcripts remembered; beyond it the oldest go first (it only saves work: a forgotten one is read again from its start). */
export const MAX_USAGE_CACHED = 2000;

interface Cached {
  size: number;
  mtimeMs: number;
  state: TailerState;
  accumulator: ModelUsageAccumulator;
  /** Why the last read failed; empty when it did not. */
  readNote: string;
}

const cache = new Map<string, Cached>();
/** One read per transcript at a time: two polls that overlap would fold the same bytes twice. */
const reading = new Map<string, Promise<SubagentUsageAnswer>>();
let totalBytesRead = 0;

export type SubagentUsageAnswer = { usage: SubagentUsageDto; note?: undefined } | { usage?: undefined; note: string };

/** Empties the cache (tests). */
export function clearSubagentUsageCache(): void {
  cache.clear();
  reading.clear();
  totalBytesRead = 0;
}

/** What the cache holds and the bytes read since it was emptied (tests: proves a poll does not read the file again). */
export function subagentUsageStats(): { entries: number; bytesRead: number } {
  return { entries: cache.size, bytesRead: totalBytesRead };
}

function answerOf(cached: Cached, agentId: string): SubagentUsageAnswer {
  if (cached.readNote !== '') {
    return { note: cached.readNote };
  }
  const status = usageStatus(cached.accumulator.rollup());
  const usage: SubagentUsageDto = {
    ...(status.model !== undefined ? { model: status.model } : {}),
    ...(status.contextUsedPct !== undefined ? { contextUsedPct: status.contextUsedPct } : {}),
    ...(status.tokensIn !== undefined ? { tokensIn: status.tokensIn } : {}),
    ...(status.tokensOut !== undefined ? { tokensOut: status.tokensOut } : {}),
  };
  if (usage.tokensIn === undefined && usage.tokensOut === undefined) {
    return { note: 'No assistant message with usage in its transcript yet.' };
  }
  return { usage };
}

async function refresh(info: { agentId: string; transcriptPath: string }, limit: number): Promise<SubagentUsageAnswer> {
  const { agentId, transcriptPath: path } = info;
  let size: number;
  let mtimeMs: number;
  try {
    const stats = await stat(path);
    size = stats.size;
    mtimeMs = stats.mtimeMs;
  } catch (error) {
    cache.delete(path);
    const code = (error as NodeJS.ErrnoException).code;
    return { note: code === 'ENOENT' || code === 'ENOTDIR' ? 'No transcript yet: the sub-agent has not written anything.' : `The transcript could not be read: ${getErrorMessage(error)}` };
  }
  let cached = cache.get(path);
  if (cached !== undefined && cached.size === size && cached.mtimeMs === mtimeMs && cached.readNote === '') {
    return answerOf(cached, agentId);
  }
  cached ??= { size: -1, mtimeMs: -1, state: createTailerState(), accumulator: new ModelUsageAccumulator(true, agentId), readNote: '' };
  const tailer = new TranscriptTailer({ agentId });
  for (;;) {
    const result = await tailer.readNew(path, cached.state);
    if (result.error !== undefined) {
      // violations-suppress: ts/no-err-message-direct a ReadError value ({ message, hint }) of the tailer, not a caught Error
      cached.readNote = `The transcript could not be read: ${result.error.message} ${result.error.hint}`.trim();
      break;
    }
    if (result.truncated === true) {
      // Replaced or shortened: what was folded belongs to another file.
      cached.accumulator = new ModelUsageAccumulator(true, agentId);
    }
    cached.readNote = '';
    cached.state = result.state;
    totalBytesRead += result.bytesRead;
    cached.accumulator.add(result.entries);
    if (!result.more) {
      break;
    }
  }
  cached.size = size;
  cached.mtimeMs = mtimeMs;
  cache.delete(path);
  cache.set(path, cached);
  while (cache.size > limit) {
    const oldest = cache.keys().next();
    if (oldest.done === true) {
      break;
    }
    cache.delete(oldest.value);
  }
  return answerOf(cached, agentId);
}

/**
 * The usage of a sub-agent. `readError` (the transcript exists but could not be opened, see SubagentInfo) is passed on as the note, never as "no usage".
 * Never throws: every failure is a `note` with the reason, shown by the card.
 */
export async function subagentUsageOf(info: { agentId: string; transcriptPath: string; readError?: string }, limit: number = MAX_USAGE_CACHED): Promise<SubagentUsageAnswer> {
  if (info.readError !== undefined) {
    return { note: info.readError };
  }
  const running = reading.get(info.transcriptPath);
  if (running !== undefined) {
    return running;
  }
  const started = refresh(info, limit).catch((error: unknown): SubagentUsageAnswer => ({ note: `The transcript could not be read: ${getErrorMessage(error)}` }));
  reading.set(info.transcriptPath, started);
  try {
    return await started;
  } finally {
    reading.delete(info.transcriptPath);
  }
}
