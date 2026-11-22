import { contextWindowOf, describeModel, parseModelId, type ContextWindow } from './models.js';
import type { Entry, ModelRef, UsageEntry } from './types.js';

/** Previous models remembered (most recent first). */
export const MAX_PREVIOUS_MODELS = 8;
/** Usage entries kept to apply an update of a message (same key) to; older ones are folded into the totals. Bounded whatever the transcript size. */
const RECENT_USAGE = 64;

export type LastUsage = {
  messageId?: string;
  /** Epoch ms of the line, when it has one. */
  at?: number;
  /**
   * Tokens of the prompt of that API call: input + cache creation + cache read. This IS what the status line of Claude Code shows as "total_input_tokens"
   * (it is the size of the context, not a running total): `total_input_tokens = current_usage.input_tokens + cache_creation + cache_read`, read in the binary.
   */
  contextTokens: number;
  /** `output_tokens` of that message; the status line shows it as "total_output_tokens" (the last message, not a running total). */
  outputTokens: number;
};

export type ModelUsageRollup = {
  /** The model of the last main-session assistant entry; absent when none was seen. */
  currentModel?: ModelRef;
  /** Models used before the current one, most recent first, without duplicates, at most MAX_PREVIOUS_MODELS. */
  previousModels: ModelRef[];
  lastUsage?: LastUsage;
  /** Context window assumed for the current model (an estimate, see contextWindowOf), with the usage seen: absent when there is no usage. */
  window?: ContextWindow;
  /** used = round(contextTokens / window * 100), clamped to 0..100, like Claude Code (`Math.round(r/n*100)`): exact formula, ESTIMATED window. */
  usedPct?: number;
  /** round(contextTokens / compactAtTokens * 100), clamped to 0..100: how close the session is to its auto-compact (100 = compacts at the next turn). */
  compactPct?: number;
  /** Sum of input + cache read + cache creation tokens of every assistant message counted (what was sent), and of the output tokens. */
  cumulativeInput: number;
  cumulativeOutput: number;
  /** True only when the accumulator saw the transcript from its first line: otherwise the cumulative sums miss what came before. */
  cumulativeComplete: boolean;
  /** Assistant messages counted in the cumulative sums. */
  messages: number;
};

const percent = (part: number, whole: number): number => Math.min(100, Math.max(0, Math.round((part / whole) * 100)));
const sumInput = (u: UsageEntry): number => u.inputTokens + u.cacheRead + u.cacheCreate;

/**
 * Folds entries (in file order, tool-call upserts irrelevant) into the model and usage figures of a session. Bounded: it keeps the last RECENT_USAGE usage
 * entries (updates of a message arrive with the same key) and counters. Feed it the entries of a tail window, or all the entries from the start of the
 * transcript with `fromStart: true` to make the cumulative sums complete.
 */
export class ModelUsageAccumulator {
  private current: ModelRef | undefined;
  private readonly previous: ModelRef[] = [];
  private readonly recent = new Map<string, UsageEntry>();
  private latest: UsageEntry | undefined;
  private folded = { input: 0, output: 0, messages: 0 };
  private readonly names = new Map<string, { modelId: string; displayName: string }>();

  constructor(private readonly fromStart = false) {}

  add(entries: readonly Entry[]): void {
    for (const entry of entries) {
      if (entry.kind === 'model-info') {
        const canonical = parseModelId(entry.modelId).canonical;
        // The attachment follows the first message of the model: it names the current model exactly (and carries the 1M tag).
        if (this.current?.id !== undefined && parseModelId(this.current.id).canonical === canonical) {
          this.current = describeModel(entry.modelId, entry.displayName);
        } else {
          // Written before the first message of that model (session start, after /model): used by that message only.
          this.names.set(canonical, { modelId: entry.modelId, displayName: entry.displayName });
        }
      } else if (entry.kind === 'assistant-text' || entry.kind === 'usage') {
        if (entry.ownerAgentId === undefined) {
          this.noteModel(entry.model);
        }
        if (entry.kind === 'usage' && entry.ownerAgentId === undefined && entry.model !== '<synthetic>') {
          this.noteUsage(entry);
        }
      }
    }
  }

  private noteModel(raw: string | undefined): void {
    if (raw === undefined || raw === '' || raw === '<synthetic>') {
      return;
    }
    const canonical = parseModelId(raw).canonical;
    if (this.current?.id !== undefined && parseModelId(this.current.id).canonical === canonical) {
      return;
    }
    if (this.current !== undefined) {
      const kept = this.previous.filter((model) => model.id === undefined || parseModelId(model.id).canonical !== canonical);
      this.previous.length = 0;
      this.previous.push(this.current, ...kept);
      this.previous.length = Math.min(this.previous.length, MAX_PREVIOUS_MODELS);
    }
    const named = this.names.get(canonical);
    this.current = named === undefined ? describeModel(raw) : describeModel(named.modelId, named.displayName);
    this.names.delete(canonical);
  }

  private noteUsage(usage: UsageEntry): void {
    this.recent.set(usage.key, usage);
    this.latest = usage;
    if (this.recent.size > RECENT_USAGE) {
      const oldest = this.recent.keys().next().value;
      if (oldest !== undefined) {
        const gone = this.recent.get(oldest)!;
        this.recent.delete(oldest);
        this.folded = { input: this.folded.input + sumInput(gone), output: this.folded.output + gone.outputTokens, messages: this.folded.messages + 1 };
      }
    }
  }

  rollup(): ModelUsageRollup {
    let input = this.folded.input;
    let output = this.folded.output;
    for (const usage of this.recent.values()) {
      input += sumInput(usage);
      output += usage.outputTokens;
    }
    const last = this.latest;
    const lastUsage: LastUsage | undefined =
      last === undefined ? undefined : { ...(last.messageId !== undefined ? { messageId: last.messageId } : {}), ...(last.timestamp !== undefined ? { at: last.timestamp } : {}), contextTokens: sumInput(last), outputTokens: last.outputTokens };
    const window = lastUsage === undefined ? undefined : contextWindowOf(this.current, lastUsage.contextTokens);
    return {
      ...(this.current !== undefined ? { currentModel: this.current } : {}),
      previousModels: [...this.previous],
      ...(lastUsage !== undefined ? { lastUsage } : {}),
      ...(window !== undefined && lastUsage !== undefined ? { window, usedPct: percent(lastUsage.contextTokens, window.tokens), compactPct: percent(lastUsage.contextTokens, window.compactAtTokens) } : {}),
      cumulativeInput: input,
      cumulativeOutput: output,
      cumulativeComplete: this.fromStart,
      messages: this.folded.messages + this.recent.size,
    };
  }
}

/** One-shot rollup of a list of entries (a tail window: cumulative sums are then incomplete). */
export function rollupModelUsage(entries: readonly Entry[], fromStart = false): ModelUsageRollup {
  const accumulator = new ModelUsageAccumulator(fromStart);
  accumulator.add(entries);
  return accumulator.rollup();
}
