/**
 * HTTP contract of the Guardrails page (phase 1, read-only): GET /guardrails/overview, GET /guardrails/denials and the PIN-protected
 * GET /guardrails/denials/commands. TYPES ONLY (shared by src/backend and src/dsl-components, see commons/api.ts for the conventions).
 *
 * Everything here is read from the files of the w-guardrails plugin by a versioned reader that refuses any shape it does not know
 * (a `GuardrailsProblem`), never guessing. The module only reads those files.
 */

/** A file the module could not read or whose shape it does not know: shown as is, with what to do. */
export interface GuardrailsProblem {
  /** Absolute path of the file. */
  file: string;
  /** What is wrong (names the field or the parse error). */
  message: string;
  /** What to do about it. */
  hint: string;
}

/** A bypass granted by the user to a session (one entry of the grants file that the hook still honours). */
export interface GrantDto {
  id: string;
  category: string;
  mode: 'once' | 'ttl';
  /** Epoch ms of the expiry. */
  expiresAt: number;
  /** Milliseconds left at `generatedAt` (never negative: expired entries are not listed). */
  remainingMs: number;
  /** The full session id of the grant. */
  sessionId: string;
  /** The registry name of that session, empty when the session is not in the registry (any more). */
  sessionName: string;
  /** Working directory of the project whose folder holds the grant. */
  project: string;
  /** The reason the agent gave (cut to 160 characters). */
  rationale: string;
  /** Uses so far; `maxUses` is null for a time-boxed grant (no limit). */
  used: number;
  maxUses: number | null;
}

/** What the counters of one session in one project say (the plugin's state file of the project). */
export interface SessionBlocksDto {
  /** The key of the file: the full session id. */
  sessionId: string;
  /** The first 8 characters (what the journals carry). */
  prefix: string;
  sessionName: string;
  project: string;
  /** Times each category blocked the session, most first. Counts only the denials that carry a bypass hint (the journal counts every deny and ask). */
  blocks: { category: string; count: number }[];
  total: number;
  /** Refused or ignored bypass requests (3 start a 30 minute timeout). */
  refusedCount: number;
  /** Epoch ms of the end of the timeout, null when there is none running. */
  timeoutUntil: number | null;
  /** Epoch ms of the last bypass request, null when none. */
  lastRequestAt: number | null;
}

/** The project rules file (.claude/guardrails.json) as written. The defaults of the plugin are not shown (they live in plugin code, see `rulesNote`). */
export interface ProjectConfigDto {
  project: string;
  file: string;
  /** absent: the project has no file (the hook uses its built-in defaults); malformed: JSON that cannot be parsed or has an unknown shape (the hook IGNORES it). */
  state: 'absent' | 'ok' | 'malformed' | 'unreadable';
  /** The decisions given in the file. */
  categories: { name: string; decision: string }[];
  categoryMessages: number;
  protectedFiles: { glob: string; decision: string }[];
  hasSecrets: boolean;
  /** Unknown keys or values: the file is shown but these need a look. */
  warnings: string[];
  /** Why the state is malformed or unreadable ("message. hint"), empty otherwise. */
  errorText: string;
}

/** A project folder the overview looked at, and why. */
export interface ScannedProject {
  path: string;
  /** registry: a session of the Claude Code registry works there; owned: a session of the daemon; journal: a denial of the journal names it. */
  sources: ('registry' | 'owned' | 'journal')[];
  /** The folder has at least one plugin state file (grants, counters or rules). */
  hasFiles: boolean;
}

export interface GuardrailsOverviewDto {
  ok: true;
  generatedAt: string;
  /** The kill switch file exists: ALL protections are off. */
  killSwitch: { active: boolean; path: string; errorText: string };
  projects: ScannedProject[];
  /** What the project list was built from, one sentence per source, with the count or why it is missing. */
  sourcesText: string[];
  grants: GrantDto[];
  sessions: SessionBlocksDto[];
  configs: ProjectConfigDto[];
  /** Files that could not be read or whose shape is unknown: never silent. */
  problems: GuardrailsProblem[];
  /** Entries the hook ignores (expired, used up, more than 24 h ahead) that were left out of `grants`. */
  hiddenEntries: number;
  /** Why the effective rules are not shown. */
  rulesNote: string;
  /** The version of the file shapes this reader knows. */
  formatVersion: number;
}

/** One denial or ask of the blocked journal. `command` is only present in the PIN-protected route. */
export interface DenialDto {
  /** Epoch ms. */
  at: number;
  day: string;
  /** The journal's session text: 8 characters then ":M" (main agent) or ":A:<4>:<type>" (sub-agent). */
  session: string;
  prefix: string;
  sessionName: string;
  decision: 'deny' | 'ask';
  /** The category (or rule) that fired. */
  category: string;
  project: string;
  tool: string;
  /** The file of a Write or Edit, empty otherwise. */
  file: string;
  hasCommand: boolean;
  /** The command as the journal holds it (up to 500 characters, NOT masked). Absent unless the PIN-protected route answered. */
  command?: string;
}

export interface DenialsDto {
  ok: true;
  generatedAt: string;
  denials: DenialDto[];
  /** The day files of the journal, newest first (the day filter's choices). */
  days: string[];
  /** The categories among the examined records (the category filter's choices). */
  categories: string[];
  /** The filters as understood. */
  filter: { day: string; category: string; session: string; limit: number };
  /** True when older records exist that were not read (byte budget or limit reached). */
  truncated: boolean;
  bytesRead: number;
  /** Lines of the journal this reader does not understand (unknown field, bad JSON), with the first one named. Never skipped silently. */
  skipped: { count: number; example: string };
  /** The command texts are included (PIN-protected route). */
  withCommands: boolean;
  /** Always set: the texts of the journal are not masked. */
  note: string;
  problems: GuardrailsProblem[];
}

/**
 * The window of the "recent" blocks, the only ones the list badge shows (the full history is noise there). Evaluated against the clock of each poll of
 * GET /sessions, on the `ts` of the journal records.
 */
export const RECENT_BLOCK_WINDOW_MS = 30 * 60_000;

/** What a session row says about the guardrails. Absent when there is nothing to say. */
export interface GuardrailBlocksDto {
  /** All time, from the plugin counters of the session folder (denials that carry a bypass hint only). 0 when the session has no counters. */
  total: number;
  /** Most blocked first. */
  categories: { category: string; count: number }[];
  /** A bypass request timeout is running for this session. */
  timeout: boolean;
  /**
   * The denials of the blocked journal of this session (sub-agents included) in the last RECENT_BLOCK_WINDOW_MS, most blocked first. A different source
   * than `total`: the journal counts every deny, the counters only the ones with a bypass hint, so `recent.total` can exceed `total`.
   */
  recent: { total: number; categories: { category: string; count: number }[] };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The bypasses of ONE session, from the admin CLI of the plugin (threat-model T-22)
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** A bypass the plugin's own CLI lists (the hook would honour it). */
export interface CliGrantDto {
  /** 8 hexadecimal characters. */
  id: string;
  category: string;
  mode: 'once' | 'ttl';
  /** The FULL session id. */
  sessionId: string;
  /** Epoch ms of the expiry. */
  expiresAt: number;
  /** Milliseconds left when the list was read. */
  remainingMs: number;
  /** The same, as text ("9 min"), for a client that does not count down. */
  remainingText: string;
  /** Uses left of a "once" grant, null for a time-boxed one. */
  usesLeft: number | null;
  reason: string;
  /** 'ui' for a bypass made through the PIN-gated Add of this module, another text for another origin, null when the plugin gives none (an older grant). */
  origin: string | null;
}

/**
 * GET /guardrails/sessions/:sessionId/grants (read-only, no PIN). Always HTTP 200: a failure is `ok: false` with `code` and `errorText` (message and fix).
 * `code` 'not-installed' means the admin CLI is absent: the page then reads the files itself and says so.
 */
export interface SessionGrantsDto {
  ok: boolean;
  /** '' when ok, else the machine code (a GuardrailsAdminError code, 'no-cwd' or 'registry-unreadable'). */
  code: string;
  sessionId: string;
  /** The folder the plugin was asked about: the cwd of the session as the transcript reports it now. '' when unknown. */
  cwd: string;
  /** "cwd used: <path> (the session moved from <registry cwd>)" when it differs from the registry, or why it could not be checked; '' when they agree. */
  cwdNote: string;
  grants: CliGrantDto[];
  errorText: string;
}

/** POST /guardrails/grants/:id/revoke, success. A failure is the usual `{ ok: false, error: { code, message, hint } }`. */
export interface GrantRevokedDto {
  ok: true;
  id: string;
  category: string;
  sessionId: string;
  cwd: string;
  /** '' when the audit line was written; else why it was not (the grant IS revoked). */
  auditError: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Add a bypass and the rules of the plugin (threat-model T-23)
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** The durations the plugin accepts for a grant. */
export const GRANT_MODES = ['once', '10m', '30m', '4h'] as const;
export type GrantModeDto = (typeof GRANT_MODES)[number];

/** Longest rationale accepted (plain text, one line). */
export const MAX_RATIONALE_CHARS = 300;

/** One category of the guardrails for a folder, as `rules --json` of the plugin reports it. */
export interface RuleCategoryDto {
  name: string;
  decision: 'allow' | 'ask' | 'deny';
  source: 'default' | 'config' | 'hardcoded';
  /** False for the categories no bypass can lift (hardcoded or config/secrets ones). */
  bypassable: boolean;
  hardcoded: boolean;
}

/**
 * GET /guardrails/sessions/:sessionId/rules (read-only, no PIN). Always HTTP 200: a failure is `ok: false` with `code` and `errorText`, like the grants route.
 * `configError` is the text the plugin gives when the guardrails.json of the folder cannot be read ('' when none).
 */
export interface SessionRulesDto {
  ok: boolean;
  code: string;
  sessionId: string;
  cwd: string;
  cwdNote: string;
  configPath: string;
  configPresent: boolean;
  configError: string;
  categories: RuleCategoryDto[];
  errorText: string;
}

/** POST /guardrails/sessions/:sessionId/grants, success. A failure is the usual `{ ok: false, error: { code, message, hint } }`. */
export interface GrantAddedDto {
  ok: true;
  id: string;
  category: string;
  mode: GrantModeDto;
  sessionId: string;
  cwd: string;
  /** Epoch ms. */
  expiresAt: number;
  origin: string | null;
  /** '' when the audit line was written; else why it was not (the grant IS made). */
  auditError: string;
}
