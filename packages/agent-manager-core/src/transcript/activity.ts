import { applyOrphanResult } from './merge.js';
import { LIMITS } from './types.js';
import type { ActivitySummary, Entry, ToolCallEntry, UsageEntry } from './types.js';

/**
 * Folds entries one by one into an ActivitySummary, so a long-lived session never re-reads what it already counted. Tool calls are upserted by key:
 * feed the update entries of readNew() as they come.
 */
export class ActivityAccumulator {
  private lastPromptAt: number | undefined;
  private lastAssistantAt: number | undefined;
  private tokensTotal = 0;
  private cacheReadTotal = 0;
  private contextEstimate = 0;
  private turnsCount = 0;
  private noticeErrors = 0;
  private lastTool: ToolCallEntry | undefined;
  private readonly calls = new Map<string, ToolCallEntry>();
  // Only keys of usage entries that can still be raised (recent messages): bounded below.
  private readonly usage = new Map<string, UsageEntry>();

  add(entry: Entry): void {
    // Other kinds (queue operations, markers, unknown lines) say nothing about activity.
    if (entry.kind === 'user-prompt') {
      if (entry.source === 'human' && entry.timestamp !== undefined) {
        this.lastPromptAt = entry.timestamp;
      }
      if (entry.source === 'human' || entry.source === 'peer' || entry.source === 'task-notification') {
        this.turnsCount += 1;
      }
    } else if (entry.kind === 'assistant-text' || entry.kind === 'thinking') {
      this.touchAssistant(entry.timestamp);
    } else if (entry.kind === 'tool-call') {
      this.touchAssistant(entry.startedAt ?? entry.timestamp);
      this.addCall(entry);
    } else if (entry.kind === 'usage') {
      // An entry with a key already seen is the raised usage of the same message: replace, do not add.
      const previous = this.usage.get(entry.key);
      if (previous !== undefined) {
        this.tokensTotal -= previous.inputTokens + previous.outputTokens + previous.cacheCreate;
        this.cacheReadTotal -= previous.cacheRead;
      }
      this.usage.set(entry.key, entry);
      if (this.usage.size > LIMITS.recentMessageIds * 2) {
        // The oldest message can no longer be raised (the tailer forgot it).
        this.usage.delete(this.usage.keys().next().value as string);
      }
      this.tokensTotal += entry.inputTokens + entry.outputTokens + entry.cacheCreate;
      this.cacheReadTotal += entry.cacheRead;
      this.contextEstimate = entry.contextEstimate;
    } else if (entry.kind === 'system-notice' && entry.level === 'error') {
      this.noticeErrors += 1;
    }
  }

  private touchAssistant(timestamp: number | undefined): void {
    if (timestamp !== undefined && (this.lastAssistantAt === undefined || timestamp > this.lastAssistantAt)) {
      this.lastAssistantAt = timestamp;
    }
  }

  private addCall(entry: ToolCallEntry): void {
    const previous = this.calls.get(entry.key);
    // An orphan result carries no name: it must not replace the call it completes.
    const merged = previous !== undefined && entry.orphan === true ? applyOrphanResult(previous, entry) : entry;
    this.calls.set(entry.key, merged);
    if (entry.orphan !== true && (this.lastTool === undefined || (entry.startedAt ?? 0) >= (this.lastTool.startedAt ?? 0))) {
      this.lastTool = merged;
    } else if (this.lastTool?.key === entry.key) {
      this.lastTool = merged;
    }
  }

  summary(): ActivitySummary {
    const running = [...this.calls.values()].filter(c => c.status === 'running');
    let errors = this.noticeErrors;
    for (const call of this.calls.values()) {
      if (call.status === 'error') {
        errors += 1;
      }
    }
    return {
      ...(this.lastPromptAt !== undefined ? { lastPromptAt: this.lastPromptAt } : {}),
      ...(this.lastAssistantAt !== undefined ? { lastAssistantAt: this.lastAssistantAt } : {}),
      runningToolCalls: running,
      ...(this.lastTool !== undefined ? { lastToolSummary: toolSummary(this.lastTool) } : {}),
      tokensTotal: this.tokensTotal,
      cacheReadTotal: this.cacheReadTotal,
      contextEstimate: this.contextEstimate,
      turnsCount: this.turnsCount,
      errorsCount: errors,
    };
  }
}

/** "Bash: npm test", or just the tool name when the input gave no summary. */
export function toolSummary(call: Pick<ToolCallEntry, 'name' | 'inputSummary'>): string {
  return call.inputSummary === '' ? call.name : `${call.name}: ${call.inputSummary}`;
}

/** The activity of a session for the overview, from its normalised entries (main transcript; sub-agent entries are the caller's choice to include). */
export function summarizeActivity(entries: Iterable<Entry>): ActivitySummary {
  const acc = new ActivityAccumulator();
  for (const entry of entries) {
    acc.add(entry);
  }
  return acc.summary();
}
