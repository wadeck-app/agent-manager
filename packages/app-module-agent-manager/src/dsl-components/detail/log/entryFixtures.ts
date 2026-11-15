import type { LogEntry, LogOk, SubagentDto } from '../deps.js';
import type { ToolCall } from './grouping.js';

/** Test builders of log entries and answers (only the tests import this file). */
export function userPrompt(key: string, text: string, timestamp = 1_000): LogEntry {
  return { key, offset: 0, timestamp, kind: 'user-prompt', source: 'human', queued: false, isMeta: false, text, textTruncated: false, textBytes: text.length, images: [] };
}

export function assistantText(key: string, text: string, timestamp = 2_000): LogEntry {
  return { key, offset: 0, timestamp, kind: 'assistant-text', text, textTruncated: false, textBytes: text.length };
}

export function toolCall(id: string, patch: Partial<ToolCall> = {}): ToolCall {
  return { key: `call:${id}`, offset: 0, timestamp: 3_000, kind: 'tool-call', id, name: 'Bash', inputSummary: 'npm test', input: { command: 'npm test' }, inputTruncated: false, status: 'running', startedAt: 3_000, ...patch };
}

export function answer(entries: LogEntry[], patch: Partial<LogOk> = {}): LogOk {
  return {
    ok: true,
    sessionId: 's',
    entries,
    cursor: 'c1',
    olderCursor: null,
    more: false,
    subagents: [],
    subagentsNote: '',
    activity: { scope: 'window', runningToolCalls: [], tokensTotal: 0, contextEstimate: 0, turnsCount: 0, errorsCount: 0 },
    truncated: { fieldsCut: 0, bodyCapped: false, unreadableLines: 0 },
    limits: { textChars: 4000, inputChars: 2000, resultPreviewChars: 500, maxEntries: 500, maxBodyBytes: 1_000_000 },
    note: '',
    ...patch,
  };
}

/** A sub-agent as the route sends it (status and times are facts the tests set when they matter). */
export function subagent(patch: Partial<SubagentDto> = {}): SubagentDto {
  return { agentId: 'aaaa1111', description: 'explorer', finished: true, status: 'finished', isFork: false, children: [], ...patch };
}
