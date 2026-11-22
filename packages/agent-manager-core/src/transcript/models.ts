import type { ModelRef } from './types.js';

/**
 * Model ids of Claude Code transcripts, in every spelling observed (research/statusline-data-in-transcripts.md):
 * - Anthropic API: `claude-sonnet-5-5`, dated `claude-haiku-4-5-20251001`
 * - Bedrock: `us.anthropic.claude-sonnet-5-5`, `anthropic.claude-haiku-4-5-20251001-v1:0` (assistant `message.model` drops the region, `requestedModel` keeps it)
 * - 1M variant: a `[1m]` tag (`us.anthropic.claude-opus-5-5[1m]`), only in the `model` attachment and the cost-state; `message.model` never carries it
 * - aliases (`sonnet`, `opus`, `haiku`: sub-agent metas) and `<synthetic>` (Claude Code's own messages): not models, shown raw with known: false / ignored.
 */

/** One row of the table: the canonical id (no region, provider, date, Bedrock suffix or tag), the name Claude Code shows, and what is known of its window. */
export type ModelRow = {
  canonical: string;
  name: string;
  /**
   * The context window of the model WITHOUT a `[1m]` tag, when the transcripts prove it is not the 200k default. Evidence: sessions of this model reached
   * a 967k context with no tag and auto-compacted at about 967k (research/statusline-data-in-transcripts.md). Absent = nothing proves more than 200k.
   */
  provenWindow?: number;
  /** The window the docs give this model without a tag (code.claude.com/docs/en/model-config: "native 1M window"). Weaker than provenWindow: not observed here. */
  documentedWindow?: number;
};

/** Data, not logic: adding a model is adding a row. Names are the `marketingName` of the model attachments observed on real transcripts. */
export const MODEL_TABLE: readonly ModelRow[] = [
  { canonical: 'claude-sonnet-5-5', name: 'Sonnet 5.5', provenWindow: 1_000_000 },
  { canonical: 'claude-sonnet-5', name: 'Sonnet 5', provenWindow: 1_000_000 },
  { canonical: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
  { canonical: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
  { canonical: 'claude-sonnet-4', name: 'Sonnet 4' },
  { canonical: 'claude-opus-5-5', name: 'Opus 5.5', documentedWindow: 1_000_000 },
  { canonical: 'claude-opus-5', name: 'Opus 5', documentedWindow: 1_000_000 },
  { canonical: 'claude-opus-4-8', name: 'Opus 4.8', documentedWindow: 1_000_000 },
  { canonical: 'claude-opus-4-7', name: 'Opus 4.7', documentedWindow: 1_000_000 },
  { canonical: 'claude-opus-4-6', name: 'Opus 4.6' },
  { canonical: 'claude-opus-4-5', name: 'Opus 4.5' },
  { canonical: 'claude-haiku-5-5', name: 'Haiku 5.5', documentedWindow: 1_000_000 },
  { canonical: 'claude-haiku-4-5', name: 'Haiku 4.5' },
  { canonical: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku' },
  { canonical: 'claude-fable-5-1', name: 'Fable 5.1', documentedWindow: 1_000_000 },
  { canonical: 'claude-fable-5', name: 'Fable 5', documentedWindow: 1_000_000 },
];

export const DEFAULT_WINDOW = 200_000;
export const LARGE_WINDOW = 1_000_000;

/** The id with the region, the provider, the date, the Bedrock version and the context tag removed: `us.anthropic.claude-opus-5-5[1m]` -> `claude-opus-5-5`. */
export type ParsedModelId = { canonical: string; tag?: '1m' | '2m' };

export function parseModelId(raw: string): ParsedModelId {
  let id = raw.trim().toLowerCase();
  let tag: ParsedModelId['tag'];
  const tagged = /\[([12])m\]$/.exec(id);
  if (tagged !== null) {
    tag = tagged[1] === '1' ? '1m' : '2m';
    id = id.slice(0, tagged.index);
  }
  // Vertex spells the date `@20251001`.
  id = id.replace(/@\d{8}$/, '');
  // Bedrock: `<region>.anthropic.<model>-v1:0` (region us, eu, apac, global, ...), or `anthropic.<model>`.
  id = id.replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '');
  id = id.replace(/-v\d+(?::\d+)?$/, '');
  id = id.replace(/-\d{8}$/, '');
  return tag === undefined ? { canonical: id } : { canonical: id, tag };
}

/** Whether two raw ids are the same model (same canonical id; the tag is a window variant of the same model). */
export function sameModel(a: string, b: string): boolean {
  return parseModelId(a).canonical === parseModelId(b).canonical;
}

const BY_CANONICAL: ReadonlyMap<string, ModelRow> = new Map(MODEL_TABLE.map((row) => [row.canonical, row]));
const BY_NAME: ReadonlyMap<string, ModelRow> = new Map(MODEL_TABLE.map((row) => [row.name.toLowerCase(), row]));

/** `(1M context)` suffix of the names Claude Code shows for the 1M variant. */
const LARGE_SUFFIX = /\s*\(1M context\)/i;

/**
 * The model for the UI. `marketingName` (the model attachment) wins over the table because Claude Code wrote it; without it the name comes from the table
 * (plus " (1M context)" for a `[1m]` tag); an id the table does not know is shown raw with known: false.
 */
export function describeModel(rawId: string, marketingName?: string): ModelRef {
  const parsed = parseModelId(rawId);
  const row = BY_CANONICAL.get(parsed.canonical);
  if (marketingName !== undefined && marketingName.trim() !== '') {
    return { id: rawId, displayName: marketingName.trim(), known: row !== undefined };
  }
  if (row === undefined) {
    return { id: rawId, displayName: rawId, known: false };
  }
  return { id: rawId, displayName: parsed.tag === '1m' ? `${row.name} (1M context)` : row.name, known: true };
}

/** A model known by its name only (the stdout of `/model`): known when the name, without its `(1M context)` suffix, is in the table. */
export function describeModelName(name: string): ModelRef {
  const trimmed = name.trim();
  return { displayName: trimmed, known: BY_NAME.has(trimmed.replace(LARGE_SUFFIX, '').toLowerCase()) };
}

/** Where the window of a model comes from, strongest evidence first. */
export type WindowSource = 'id-tag' | 'marketing-name' | 'table-proven' | 'table-documented' | 'observed-over-default' | 'default';

/**
 * Claude Code compacts this many tokens below the window: 967k for a 1M window (docs: "at about 967K tokens by default"), 167k for a 200k window
 * (measured: 69 of the 179 auto compactions of the local transcripts have preTokens between 167,000 and 169,999; the sampled files are Sonnet 4.6 sessions). Not read from Claude Code.
 */
export const AUTO_COMPACT_BUFFER = 33_000;

/** The context size at which Claude Code auto-compacts, for a window. A window the user shrank with /autocompact or CLAUDE_CODE_AUTO_COMPACT_WINDOW is NOT known here. */
export const compactAtOf = (windowTokens: number): number => windowTokens - AUTO_COMPACT_BUFFER;

export type ContextWindow = { tokens: number; source: WindowSource; note: string; /** The context size at which auto-compact is assumed to fire (window - 33k). */ compactAtTokens: number };

/**
 * The context window used for the percentage. It is an ESTIMATE in every case: Claude Code takes it from a model catalog and a beta flag that no transcript
 * records (the `context_window_size` of the status line payload is not written to the transcript). Order of evidence:
 * 1. `[1m]` tag in the id of the model attachment, 2. "(1M context)" in its marketing name, 3. the table says the model is proven to run above 200k,
 * 4. the context already seen is above 200k (the window cannot be 200k), 5. the 200k default.
 */
export function contextWindowOf(model: { id?: string; displayName?: string } | undefined, contextTokens: number | undefined): ContextWindow {
  const found = windowEvidence(model, contextTokens);
  return { ...found, compactAtTokens: compactAtOf(found.tokens) };
}

function windowEvidence(model: { id?: string; displayName?: string } | undefined, contextTokens: number | undefined): Omit<ContextWindow, 'compactAtTokens'> {
  const tag = model?.id === undefined ? undefined : parseModelId(model.id).tag;
  if (tag === '1m') {
    return { tokens: LARGE_WINDOW, source: 'id-tag', note: 'the model id carries the [1m] tag: 1M window' };
  }
  if (model?.displayName !== undefined && LARGE_SUFFIX.test(model.displayName)) {
    return { tokens: LARGE_WINDOW, source: 'marketing-name', note: 'the model name says "(1M context)": 1M window' };
  }
  const row = model?.id === undefined ? undefined : BY_CANONICAL.get(parseModelId(model.id).canonical);
  if (row?.provenWindow !== undefined) {
    return { tokens: row.provenWindow, source: 'table-proven', note: `${row.name} was observed above 200k tokens without the [1m] tag: ${row.provenWindow / 1000}k window assumed` };
  }
  if (row?.documentedWindow !== undefined) {
    return { tokens: row.documentedWindow, source: 'table-documented', note: `${row.name} runs a ${row.documentedWindow / 1000}k window by default according to the Claude Code docs` };
  }
  if (contextTokens !== undefined && contextTokens > DEFAULT_WINDOW) {
    return { tokens: LARGE_WINDOW, source: 'observed-over-default', note: `the context (${contextTokens} tokens) is above 200k, so the window cannot be 200k: 1M assumed` };
  }
  return { tokens: DEFAULT_WINDOW, source: 'default', note: 'no 1M signal for this model: the 200k default is assumed' };
}
