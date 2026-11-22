import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import type { GuardrailsProblem } from '../commons/guardrails.js';
import { COUNTERS_FILE, COUNTERS_SCHEMA, GRANTS_FILE, GRANTS_SCHEMA, KILL_SWITCH_FILE, MAX_GRANTS_BYTES, MAX_OTHER_BYTES, PLUGIN_STATE_DIR, RULES_FILE } from './guardrailsNames.js';

/*
 * Versioned readers of the w-guardrails files (shape version 1 = plugin 1.29.0; its files carry a `schema` tag, older files have none, see schemaError).
 * The rule of this file: a shape it does not know is a `GuardrailsProblem` (file, what, what to do), never a guess and never an empty answer that looks like
 * "nothing there". The module only reads these files; the hook (not this code) decides what is honoured.
 */

const HOUR_MS = 60 * 60 * 1000;
/** The hook ignores a grant that expires more than 24 h from now (it looks corrupt or forged). */
const MAX_AHEAD_MS = 24 * HOUR_MS;
/** The rationale shown is cut here (the agent wrote it, and a free text is not trusted to be short). */
export const RATIONALE_MAX = 160;

const FIX_BY_HAND = 'The module only reads this file. Fix or delete it by hand in an editor (agents may not); until then the plugin treats it as empty or ignores it.';
const UNKNOWN_SHAPE_HINT = 'The plugin may have changed its file format since w-guardrails 1.29.0: update this module, or ask the plugin owner for the documented schema (request A1 of research/guardrails-management.md). Nothing from this file is shown meanwhile.';

const UNKNOWN_SCHEMA_HINT = 'The plugin is newer than this module (it writes a schema tag this module does not know): update the agent-manager module. The plugin itself ignores a file with an unknown tag (fail-closed), so nothing from this file is shown meanwhile.';

export function problem(file: string, message: string, hint: string): GuardrailsProblem {
  return { file, message, hint };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Why the `schema` tag is not the one this reader knows, or undefined when it is absent (older plugin, version 1) or equal. */
export function schemaError(tag: unknown, expected: string): string | undefined {
  if (tag === undefined || tag === expected) {
    return undefined;
  }
  return typeof tag === 'string' ? `the schema '${tag}', this module knows '${expected}'` : `a 'schema' that is not text, this module knows '${expected}'`;
}

function unknownKeys(record: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(record).filter((key) => !allowed.includes(key));
}

/** A key of a file that ends up on screen and in a URL: short and made of plain characters. */
function isPlainKey(key: string): boolean {
  return /^[\w.-]{1,64}$/.test(key);
}

export type JsonRead =
  | { kind: 'absent' }
  | { kind: 'ok'; value: unknown; mtimeMs: number; size: number }
  | { kind: 'problem'; problem: GuardrailsProblem };

function isMissing(error: unknown): boolean {
  const code = error instanceof Error ? Reflect.get(error, 'code') : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Counts of the work the readers really did, for the tests of the caches (a request that finds nothing changed must do none of it). */
export const ioStats = { jsonReads: 0, discoveries: 0 };

/** Parsed files already seen, by path: the page polls every 5 s and the plugin files change rarely, so a file is read again only when its date or size changed. */
const jsonCache = new Map<string, { mtimeMs: number; ctimeMs: number; size: number; value: unknown }>();
const JSON_CACHE_MAX = 600;

/** For tests: forget every cached file. */
export function clearJsonCache(): void {
  jsonCache.clear();
}

/** Reads and parses one JSON file: absent (no file), ok, or a problem (unreadable, too big, not JSON). Bounded: a file above `maxBytes` is never loaded. */
export async function readJsonFile(file: string, maxBytes: number): Promise<JsonRead> {
  let size: number;
  let mtimeMs: number;
  let ctimeMs: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      return { kind: 'problem', problem: problem(file, 'is not a regular file', FIX_BY_HAND) };
    }
    size = info.size;
    mtimeMs = info.mtimeMs;
    ctimeMs = info.ctimeMs;
  } catch (error) {
    if (isMissing(error)) {
      return { kind: 'absent' };
    }
    return { kind: 'problem', problem: problem(file, `cannot be read: ${getErrorMessage(error)}`, 'Check the permissions of the file and of its folders; the module only needs read access.') };
  }
  if (size > maxBytes) {
    return { kind: 'problem', problem: problem(file, `is ${size} bytes, above the ${maxBytes} bytes this reader accepts`, `${FIX_BY_HAND} The module did not load it.`) };
  }
  try {
    const cached = jsonCache.get(file);
    if (cached !== undefined && cached.mtimeMs === mtimeMs && cached.ctimeMs === ctimeMs && cached.size === size) {
      return { kind: 'ok', value: cached.value, mtimeMs, size };
    }
    ioStats.jsonReads += 1;
    const text = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (jsonCache.size >= JSON_CACHE_MAX) {
      jsonCache.clear();
    }
    jsonCache.set(file, { mtimeMs, ctimeMs, size, value: parsed });
    return { kind: 'ok', value: parsed, mtimeMs, size };
  } catch (error) {
    if (isMissing(error)) {
      // Removed between the stat and the read (the hook purges expired grants): the same as absent.
      return { kind: 'absent' };
    }
    return { kind: 'problem', problem: problem(file, error instanceof SyntaxError ? `is not valid JSON: ${getErrorMessage(error)}` : `cannot be read: ${getErrorMessage(error)}`, FIX_BY_HAND) };
  }
}

export const stateDirOf = (project: string): string => path.join(project, '.claude', PLUGIN_STATE_DIR);
export const grantsFileOf = (project: string): string => path.join(stateDirOf(project), GRANTS_FILE);
export const countersFileOf = (project: string): string => path.join(stateDirOf(project), COUNTERS_FILE);
export const rulesFileOf = (project: string): string => path.join(project, '.claude', RULES_FILE);
export const killSwitchFileOf = (home: string): string => path.join(home, '.claude', PLUGIN_STATE_DIR, KILL_SWITCH_FILE);

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** A grant the hook still honours, as read (the route adds the names). */
export interface ActiveGrant {
  id: string;
  category: string;
  mode: 'once' | 'ttl';
  expiresAt: number;
  sessionId: string;
  rationale: string;
  used: number;
  maxUses: number | null;
}

const GRANT_KEYS = ['id', 'category', 'decision', 'session_id', 'mode', 'expires', 'reason', 'max_uses', 'used'] as const;

/** Why the entry is not a grant of the known shape, or undefined when it is one (the first reason only). */
function entryShapeError(entry: unknown): string | undefined {
  if (!isRecord(entry)) {
    return 'is not an object';
  }
  const extra = unknownKeys(entry, GRANT_KEYS);
  if (extra.length > 0) {
    return `has the unknown field '${extra[0]}'`;
  }
  for (const key of ['id', 'category', 'session_id'] as const) {
    if (typeof entry[key] !== 'string' || entry[key] === '') {
      return `has no text in '${key}'`;
    }
  }
  if (!isPlainKey(entry['session_id'] as string)) {
    return "has a 'session_id' that is not a plain id";
  }
  if (entry['decision'] !== 'allow') {
    return `has decision ${JSON.stringify(entry['decision'])} (only "allow" is known)`;
  }
  if (entry['mode'] !== 'once' && entry['mode'] !== 'ttl') {
    return `has mode ${JSON.stringify(entry['mode'])} (known: "once", "ttl")`;
  }
  if (typeof entry['expires'] !== 'string' || !Number.isFinite(Date.parse(entry['expires']))) {
    return "has an 'expires' that is not an ISO date text";
  }
  if (entry['reason'] !== undefined && typeof entry['reason'] !== 'string') {
    return "has a 'reason' that is not text";
  }
  for (const key of ['max_uses', 'used'] as const) {
    if (entry[key] !== undefined && !isCount(entry[key])) {
      return `has a '${key}' that is not a whole number`;
    }
  }
  return undefined;
}

export interface ParsedGrants {
  grants: ActiveGrant[];
  /** Entries of the known shape that the hook ignores: expired, used up, or expiring more than 24 h ahead. */
  hidden: number;
  problems: GuardrailsProblem[];
}

/** The grants of one file: the entries the hook honours at `now`, plus what was left out and why. An unknown top-level shape lists nothing and says so. */
export function parseGrants(value: unknown, file: string, now: number): ParsedGrants {
  const wrongSchema = isRecord(value) ? schemaError(value['schema'], GRANTS_SCHEMA) : undefined;
  if (wrongSchema !== undefined) {
    return { grants: [], hidden: 0, problems: [problem(file, `has ${wrongSchema}`, UNKNOWN_SCHEMA_HINT)] };
  }
  if (!isRecord(value) || !Array.isArray(value['overrides']) || unknownKeys(value, ['schema', 'overrides']).length > 0) {
    const found = isRecord(value) ? `the keys ${Object.keys(value).map((key) => `'${key}'`).join(', ') || '(none)'}` : 'something that is not an object';
    return { grants: [], hidden: 0, problems: [problem(file, `has an unknown shape: expected { "overrides": [...] }, found ${found}`, UNKNOWN_SHAPE_HINT)] };
  }
  const grants: ActiveGrant[] = [];
  const bad: string[] = [];
  let hidden = 0;
  (value['overrides'] as unknown[]).forEach((entry, index) => {
    const wrong = entryShapeError(entry);
    if (wrong !== undefined || !isRecord(entry)) {
      bad.push(`entry ${index + 1} ${wrong ?? 'is not an object'}`);
      return;
    }
    const grant = entry;
    const expiresAt = Date.parse(grant['expires'] as string);
    const mode = grant['mode'] as 'once' | 'ttl';
    const used = (grant['used'] as number | undefined) ?? 0;
    // The hook's own rule for a one-shot entry: max_uses defaults to 1 and the entry is used up at max_uses.
    const maxUses = mode === 'once' ? ((grant['max_uses'] as number | undefined) ?? 1) : null;
    if (now > expiresAt || expiresAt - now > MAX_AHEAD_MS || (maxUses !== null && used >= maxUses)) {
      hidden += 1;
      return;
    }
    const reason = typeof grant['reason'] === 'string' ? grant['reason'] : '';
    grants.push({ id: grant['id'] as string, category: grant['category'] as string, mode, expiresAt, sessionId: grant['session_id'] as string, rationale: reason.length > RATIONALE_MAX ? `${reason.slice(0, RATIONALE_MAX)}...` : reason, used, maxUses });
  });
  const problems = bad.length === 0 ? [] : [problem(file, `${bad.length} of ${(value['overrides'] as unknown[]).length} entries are not shown, they do not have the known shape: ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? '; ...' : ''}`, UNKNOWN_SHAPE_HINT)];
  return { grants, hidden, problems };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export interface RawSessionBlocks {
  sessionId: string;
  blocks: { category: string; count: number }[];
  total: number;
  refusedCount: number;
  timeoutUntil: number | null;
  lastRequestAt: number | null;
}

const COUNTER_KEYS = ['refused_count', 'last_request_ts', 'timeout_until', 'block_counts'] as const;

function counterShapeError(entry: unknown): string | undefined {
  if (!isRecord(entry)) {
    return 'is not an object';
  }
  const extra = unknownKeys(entry, COUNTER_KEYS);
  if (extra.length > 0) {
    return `has the unknown field '${extra[0]}'`;
  }
  if (entry['refused_count'] !== undefined && !isCount(entry['refused_count'])) {
    return "has a 'refused_count' that is not a whole number";
  }
  for (const key of ['last_request_ts', 'timeout_until'] as const) {
    const field = entry[key];
    if (field !== undefined && field !== null && (typeof field !== 'string' || !Number.isFinite(Date.parse(field)))) {
      return `has a '${key}' that is neither null nor an ISO date text`;
    }
  }
  const counts = entry['block_counts'];
  if (counts !== undefined && (!isRecord(counts) || !Object.keys(counts).every(isPlainKey) || !Object.values(counts).every(isCount))) {
    return "has 'block_counts' that is not { category: whole number }";
  }
  return undefined;
}

export interface ParsedCounters {
  sessions: RawSessionBlocks[];
  problems: GuardrailsProblem[];
}

/** The counters of one file. A timeout in the past is reported as no timeout (the hook resets it on its next check). */
export function parseCounters(value: unknown, file: string, now: number): ParsedCounters {
  const wrongSchema = isRecord(value) ? schemaError(value['schema'], COUNTERS_SCHEMA) : undefined;
  if (wrongSchema !== undefined) {
    return { sessions: [], problems: [problem(file, `has ${wrongSchema}`, UNKNOWN_SCHEMA_HINT)] };
  }
  if (!isRecord(value) || !isRecord(value['requests']) || unknownKeys(value, ['schema', 'requests']).length > 0) {
    const found = isRecord(value) ? `the keys ${Object.keys(value).map((key) => `'${key}'`).join(', ') || '(none)'}` : 'something that is not an object';
    return { sessions: [], problems: [problem(file, `has an unknown shape: expected { "requests": { "<sessionId>": {...} } }, found ${found}`, UNKNOWN_SHAPE_HINT)] };
  }
  const sessions: RawSessionBlocks[] = [];
  const bad: string[] = [];
  for (const [sessionId, entry] of Object.entries(value['requests'])) {
    const wrong = !isPlainKey(sessionId) ? 'has a key that is not a plain session id' : counterShapeError(entry);
    if (wrong !== undefined || !isRecord(entry)) {
      bad.push(`session '${sessionId.slice(0, 40)}' ${wrong ?? 'is not an object'}`);
      continue;
    }
    const record = entry;
    const blocks = Object.entries((record['block_counts'] as Record<string, number> | undefined) ?? {})
      .map(([category, count]) => ({ category, count }))
      .filter((block) => block.count > 0)
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
    const until = typeof record['timeout_until'] === 'string' ? Date.parse(record['timeout_until']) : undefined;
    const last = typeof record['last_request_ts'] === 'string' ? Date.parse(record['last_request_ts']) : undefined;
    sessions.push({
      sessionId,
      blocks,
      total: blocks.reduce((sum, block) => sum + block.count, 0),
      refusedCount: (record['refused_count'] as number | undefined) ?? 0,
      timeoutUntil: until !== undefined && until > now ? until : null,
      lastRequestAt: last ?? null,
    });
  }
  const problems = bad.length === 0 ? [] : [problem(file, `${bad.length} session entries are not shown, they do not have the known shape: ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? '; ...' : ''}`, UNKNOWN_SHAPE_HINT)];
  return { sessions, problems };
}

/** The counters of a project folder, its sessions and its problems (the file read is cached by readJsonFile). Absent file: no sessions, no problem. */
export async function readCounters(project: string, now: number): Promise<ParsedCounters & { present: boolean }> {
  const file = countersFileOf(project);
  const read = await readJsonFile(file, MAX_OTHER_BYTES);
  if (read.kind === 'absent') {
    return { sessions: [], problems: [], present: false };
  }
  if (read.kind === 'problem') {
    return { sessions: [], problems: [read.problem], present: true };
  }
  return { ...parseCounters(read.value, file, now), present: true };
}
// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Rules file
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export const KNOWN_DECISIONS = ['deny', 'ask', 'allow', 'advise'] as const;
const RULES_KEYS = ['categories', 'category_messages', 'protected_files', 'secrets', 'bypass_hints'] as const;

export interface ParsedRules {
  state: 'ok' | 'malformed';
  categories: { name: string; decision: string }[];
  categoryMessages: number;
  protectedFiles: { glob: string; decision: string }[];
  hasSecrets: boolean;
  warnings: string[];
  errorText: string;
}

/** The project rules as written. A container of the wrong type is `malformed` (nothing listed); an unknown key or decision is a warning and the rest is shown. */
export function parseRules(value: unknown): ParsedRules {
  const empty: ParsedRules = { state: 'malformed', categories: [], categoryMessages: 0, protectedFiles: [], hasSecrets: false, warnings: [], errorText: '' };
  if (!isRecord(value)) {
    return { ...empty, errorText: `The file must hold a JSON object, found ${Array.isArray(value) ? 'an array' : typeof value}. ${FIX_BY_HAND}` };
  }
  const warnings: string[] = unknownKeys(value, RULES_KEYS).map((key) => `Unknown key '${key}': this reader does not know it (known: ${RULES_KEYS.join(', ')}).`);
  const wrongType = (key: string, expected: string): ParsedRules => ({ ...empty, warnings, errorText: `'${key}' must be ${expected}. ${FIX_BY_HAND}` });
  const categories: { name: string; decision: string }[] = [];
  if (value['categories'] !== undefined) {
    if (!isRecord(value['categories'])) {
      return wrongType('categories', 'an object { category: "deny" | "ask" | "allow" | "advise" }');
    }
    for (const [name, decision] of Object.entries(value['categories'])) {
      if (typeof decision !== 'string' || !(KNOWN_DECISIONS as readonly string[]).includes(decision)) {
        warnings.push(`Category '${name}' has the decision ${JSON.stringify(decision)}, not one of ${KNOWN_DECISIONS.join(', ')}.`);
      }
      categories.push({ name, decision: typeof decision === 'string' ? decision : JSON.stringify(decision) });
    }
  }
  let categoryMessages = 0;
  if (value['category_messages'] !== undefined) {
    if (!isRecord(value['category_messages'])) {
      return wrongType('category_messages', 'an object { category: "message" }');
    }
    categoryMessages = Object.keys(value['category_messages']).length;
  }
  const protectedFiles: { glob: string; decision: string }[] = [];
  if (value['protected_files'] !== undefined) {
    if (!Array.isArray(value['protected_files'])) {
      return wrongType('protected_files', 'an array [{ "glob": "...", "decision": "deny" }]');
    }
    (value['protected_files'] as unknown[]).forEach((item, index) => {
      if (isRecord(item) && typeof item['glob'] === 'string' && typeof item['decision'] === 'string') {
        protectedFiles.push({ glob: item['glob'], decision: item['decision'] });
      } else {
        warnings.push(`protected_files[${index}] is not { "glob": text, "decision": text }: not shown.`);
      }
    });
  }
  return { state: 'ok', categories, categoryMessages, protectedFiles, hasSecrets: value['secrets'] !== undefined, warnings, errorText: '' };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** The kill switch: the file exists. Any other failure is an `errorText`, never "not active". */
export async function readKillSwitch(home: string): Promise<{ active: boolean; path: string; errorText: string }> {
  const file = killSwitchFileOf(home);
  try {
    await stat(file);
    return { active: true, path: file, errorText: '' };
  } catch (error) {
    if (isMissing(error)) {
      return { active: false, path: file, errorText: '' };
    }
    return { active: false, path: file, errorText: `The kill switch file ${file} cannot be checked: ${getErrorMessage(error)}. Check the permissions of ${path.dirname(file)}; protection may be OFF.` };
  }
}

/** Why the effective rules are not shown (request A2 of the study). */
export const RULES_NOTE = 'Rules view needs plugin API A2: the default decision of each category lives in the plugin code (scripts/categories.js), which this module does not execute. Shown: only what the project file .claude/guardrails.json says. A category absent from it keeps the plugin default.';
