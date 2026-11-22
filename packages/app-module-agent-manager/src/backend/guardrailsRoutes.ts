import { homedir } from 'node:os';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { defaultConfigDir, getErrorMessage, readSessionRegistry, resolveSessionsDir, type Session } from '@wadeck-app/agent-manager-core';
import { FolderError, checkAbsolutePath, isInside, pathKey, readLaunchRoots } from '@wadeck-app/agent-manager-core/folders';
import type { DenialDto, DenialsDto, GrantDto, GuardrailBlocksDto, GuardrailsOverviewDto, GuardrailsProblem, ProjectConfigDto, ScannedProject, SessionBlocksDto } from '../commons/guardrails.js';
import { errorTextOf, type OwnedSource } from './daemon/ownedSource.js';
import { countersFileOf, grantsFileOf, ioStats, parseGrants, parseRules, problem, readCounters, readJsonFile, readKillSwitch, rulesFileOf, RULES_NOTE, type ActiveGrant, type RawSessionBlocks } from './guardrailsFiles.js';
import { DAY_PATTERN, DEFAULT_BUDGET_BYTES, DEFAULT_LIMIT, journalDirOf, listJournalDays, MAX_LIMIT, readJournalTail } from './guardrailsJournal.js';
import { FORMAT_VERSION, JOURNAL_PREFIX, JOURNAL_SUFFIX, MAX_GRANTS_BYTES, MAX_OTHER_BYTES } from './guardrailsNames.js';
import { registerGrantsRoutes, type GrantsOptions } from './guardrailsGrantsRoutes.js';
import { RequestError, type RouteKit, ok, queryValue } from './routeKit.js';

/** What a test replaces; app-core gives the module nothing of this. */
export interface GuardrailsOptions extends GrantsOptions {
  /** The home folder that holds .claude/logs and .claude/w-guardrails (the kill switch). Default: the user's home. */
  homeDir?: string;
  /** Bytes of the journal one request may read (default 2 MB). */
  journalBudgetBytes?: number;
}

/** Project folders scanned per request: a bound against a registry or a journal that names thousands of folders. */
const MAX_PROJECTS = 150;
/** Bytes of the newest journal read to discover the folders that had a denial recently. */
const DISCOVERY_BYTES = 512 * 1024;
/** Records examined by that discovery. */
const DISCOVERY_RECORDS = 5000;

const NOTE_UNMASKED = 'The texts of the journal are not masked: a command may hold a token or a path the plugin does not know as a secret.';

/**
 * A folder the module may look into: a local absolute path. A network path (\\server\share, //host/x) is refused: reading it would make this machine
 * authenticate to a host named by a file (the journal) that agents can append to. Returns the cleaned path, or undefined.
 */
export function localProject(raw: unknown): string | undefined {
  try {
    return checkAbsolutePath(raw, 'the project folder');
  } catch (error) {
    // The folder rules of the module (length, control characters, UNC, '..', absolute) are those of the folder picker: a refusal is "not a folder to read".
    if (error instanceof FolderError) {
      return undefined;
    }
    throw error;
  }
}

const dedupeKey = pathKey;

function homeOf(options: GuardrailsOptions): string {
  return options.homeDir ?? homedir();
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Which project folders to look at
// ---------------------------------------------------------------------------------------------------------------------------------------------------

interface Discovery {
  projects: ScannedProject[];
  sourcesText: string[];
  problems: GuardrailsProblem[];
  /** The registry sessions (names for the grants and the denials); empty when the registry could not be read. */
  sessions: Session[];
}

type Origin = ScannedProject['sources'][number];

/**
 * The folders to scan. Sources, each stated in `sourcesText`: the working directories of the Claude Code registry (alive or ended sessions), of the sessions of
 * the agent-manager daemon, and the `project` of the newest denials of the journal (history). A source that cannot be read is said, never skipped.
 */
async function discoverUncached(options: GuardrailsOptions, source: OwnedSource, now: number): Promise<Discovery> {
  ioStats.discoveries += 1;
  const found = new Map<string, ScannedProject>();
  const sourcesText: string[] = [];
  const problems: GuardrailsProblem[] = [];
  let refused = 0;
  const add = (raw: unknown, origin: Origin): void => {
    const project = localProject(raw);
    if (project === undefined) {
      refused += 1;
      return;
    }
    const known = found.get(dedupeKey(project));
    if (known === undefined) {
      found.set(dedupeKey(project), { path: project, sources: [origin], hasFiles: false });
    } else if (!known.sources.includes(origin)) {
      known.sources.push(origin);
    }
  };

  const sessionsDir = resolveSessionsDir(process.env);
  const registry = await readSessionRegistry(sessionsDir, { now });
  let sessions: Session[] = [];
  if (registry.ok) {
    sessions = registry.sessions;
    registry.sessions.forEach((session) => add(session.cwd, 'registry'));
    sourcesText.push(`Claude Code session registry (${sessionsDir}): ${new Set(registry.sessions.map((session) => dedupeKey(session.cwd))).size} folder(s) from ${registry.sessions.length} session(s), alive or ended.`);
    if (registry.unreadable.length > 0) {
      sourcesText.push(`Session registry: ${registry.unreadable.length} file(s) unreadable, their folders are not scanned.`);
    }
  } else {
    const { message, hint } = registry.error;
    problems.push(problem(sessionsDir, `The session registry cannot be read: ${message}`, hint));
    sourcesText.push(`Claude Code session registry: NOT read (${message}). Folders of the sessions are missing from the scan.`);
  }

  const owned = await source.list();
  if (owned.ok) {
    owned.sessions.forEach((view) => add(view.cwd, 'owned'));
    sourcesText.push(`Sessions launched by the agent-manager daemon: ${owned.sessions.length} session(s).`);
  } else {
    sourcesText.push(`Sessions launched by the agent-manager daemon: NOT asked (${errorTextOf(owned.error)}). Their folders are scanned only when they also have a registry file.`);
  }

  // The journal is a file agents can append to, so a `project` in it is untrusted text: its folder is read only when it is a folder the user is known to work in
  // (a registry or daemon folder, or inside a launch root of config.yml). Any other is listed, never read.
  const known = [...found.values()].map((project) => project.path);
  let roots: string[] = [];
  try {
    roots = (await readLaunchRoots(defaultConfigDir(process.env))).roots;
  } catch (error) {
    sourcesText.push(`Launch roots NOT read (${getErrorMessage(error)}): journal folders are scanned only when a session of the registry or the daemon works there.`);
  }
  const trusted = (candidate: string): boolean => known.some((folder) => pathKey(folder) === pathKey(candidate)) || roots.some((root) => isInside(root, candidate));
  const journal = await readJournalTail(journalDirOf(homeOf(options)), { limit: DISCOVERY_RECORDS, budgetBytes: DISCOVERY_BYTES });
  if (journal.days.length === 0) {
    sourcesText.push(`Blocked journal: no day file, no folder from the history${journal.problems.length > 0 ? ` (${journal.problems[0]!.message})` : ''}.`);
  } else {
    const before = found.size;
    const unknown = new Set<string>();
    for (const record of journal.records) {
      const project = localProject(record.project);
      if (project === undefined || trusted(project)) {
        add(record.project, 'journal');
      } else {
        unknown.add(project);
      }
    }
    sourcesText.push(`Blocked journal: ${journal.records.length} newest denial(s) read (${Math.round(journal.bytesRead / 1024)} KB), ${found.size - before} folder(s) not already known.${journal.skipped.count > 0 ? ` ${journal.skipped.count} line(s) have an unknown shape, see the problems.` : ''}`);
    for (const folder of [...unknown].slice(0, 10)) {
      sourcesText.push(`Journal mentions an unknown folder: not read: ${folder}`);
    }
    if (unknown.size > 10) {
      sourcesText.push(`Journal mentions ${unknown.size - 10} more unknown folder(s): not read.`);
    }
    if (journal.skipped.count > 0) {
      problems.push(...journal.problems.filter((item) => item.message.includes('do not have the known shape')));
    }
  }
  if (refused > 0) {
    sourcesText.push(`${refused} folder name(s) were refused because they are not a local absolute path (network paths are never opened).`);
  }
  const all = [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
  if (all.length > MAX_PROJECTS) {
    sourcesText.push(`${all.length - MAX_PROJECTS} folder(s) beyond the limit of ${MAX_PROJECTS} were NOT scanned.`);
  }
  return { projects: all.slice(0, MAX_PROJECTS), sourcesText, problems, sessions };
}

/** The folder list is reused this long while the files it came from did not change (the page polls every 5 s, the registry and the daemon rarely change). */
const DISCOVERY_TTL_MS = 10_000;
const discoveryCache = new Map<string, { at: number; signature: string; value: Discovery }>();

/** For tests: forget the cached folder lists. */
export function clearGuardrailsCaches(): void {
  discoveryCache.clear();
}

/**
 * What the cached folder list came from, in one text: the newest journal file, the registry folder, config.yml (the launch roots decide which journal folders
 * are read) and the daemon's sessions (ids and folders; one cached daemon call). A change in any of them drops the cached list at once.
 */
async function signatureOf(options: GuardrailsOptions, source: OwnedSource): Promise<string> {
  const journalDir = journalDirOf(homeOf(options));
  const { days } = await listJournalDays(journalDir);
  const newest = days[0] === undefined ? undefined : path.join(journalDir, `${JOURNAL_PREFIX}${days[0]}${JOURNAL_SUFFIX}`);
  const parts: string[] = [`days:${days.length}:${days[0] ?? ''}`];
  for (const [label, target] of [['journal', newest], ['registry', resolveSessionsDir(process.env)], ['config', path.join(defaultConfigDir(process.env), 'config.yml')]] as const) {
    try {
      const info = target === undefined ? undefined : await stat(target);
      parts.push(`${label}:${info?.mtimeMs ?? 0}:${info?.size ?? 0}`);
    } catch {
      // A missing folder or file is part of the signature (it changes when it appears); the uncached read reports the problem itself.
      parts.push(`${label}:missing`);
    }
  }
  const owned = await source.list();
  parts.push(owned.ok ? `daemon:${owned.sessions.map((view) => `${view.id}@${view.cwd}`).sort().join(',')}` : `daemon:error:${owned.error.code}`);
  return parts.join('|');
}

async function discover(options: GuardrailsOptions, source: OwnedSource, now: number): Promise<Discovery> {
  const key = `${homeOf(options)}|${resolveSessionsDir(process.env)}|${defaultConfigDir(process.env)}`;
  const signature = await signatureOf(options, source);
  const cached = discoveryCache.get(key);
  const value = cached !== undefined && cached.signature === signature && now - cached.at < DISCOVERY_TTL_MS ? cached.value : await discoverUncached(options, source, now);
  if (value !== cached?.value) {
    discoveryCache.set(key, { at: now, signature, value });
  }
  // Copies: the caller sets `hasFiles` on the projects.
  return { ...value, projects: value.projects.map((project) => ({ ...project, sources: [...project.sources] })) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /guardrails/overview
// ---------------------------------------------------------------------------------------------------------------------------------------------------

const nameOf = (session: Session): string => session.name ?? session.folder;

function sessionNameById(sessions: readonly Session[], id: string): string {
  const wanted = id.toLowerCase();
  const found = sessions.find((session) => session.sessionId.toLowerCase() === wanted);
  return found === undefined ? '' : nameOf(found);
}

/** The name of the session whose id starts with the 8 characters of the journal; empty when none or when two sessions share the prefix (never a guess). */
function sessionNameByPrefix(sessions: readonly Session[], prefix: string): string {
  const wanted = prefix.toLowerCase();
  const matches = sessions.filter((session) => session.sessionId.toLowerCase().startsWith(wanted));
  return matches.length === 1 ? nameOf(matches[0]!) : '';
}

interface ProjectRead {
  project: ScannedProject;
  grants: ActiveGrant[];
  hidden: number;
  counters: RawSessionBlocks[];
  config: ProjectConfigDto | undefined;
  problems: GuardrailsProblem[];
}

async function readProject(project: ScannedProject, now: number): Promise<ProjectRead> {
  const grantsFile = grantsFileOf(project.path);
  const rulesFile = rulesFileOf(project.path);
  const [grantsRead, counters, rulesRead] = await Promise.all([readJsonFile(grantsFile, MAX_GRANTS_BYTES), readCounters(project.path, now), readJsonFile(rulesFile, MAX_OTHER_BYTES)]);
  const problems: GuardrailsProblem[] = [...counters.problems];
  let grants: ActiveGrant[] = [];
  let hidden = 0;
  if (grantsRead.kind === 'problem') {
    problems.push(grantsRead.problem);
  } else if (grantsRead.kind === 'ok') {
    const parsed = parseGrants(grantsRead.value, grantsFile, now);
    grants = parsed.grants;
    hidden = parsed.hidden;
    problems.push(...parsed.problems);
  }
  let config: ProjectConfigDto | undefined;
  const base = { project: project.path, file: rulesFile, categories: [], categoryMessages: 0, protectedFiles: [], hasSecrets: false, warnings: [] };
  if (rulesRead.kind === 'problem') {
    // A JSON error is `malformed` (the hook ignores the file and uses its defaults); a file that cannot be read at all is `unreadable`.
    const malformed = rulesRead.problem.message.startsWith('is not valid JSON');
    config = { ...base, state: malformed ? 'malformed' : 'unreadable', errorText: `${rulesRead.problem.message}. ${rulesRead.problem.hint}` };
  } else if (rulesRead.kind === 'ok') {
    const parsed = parseRules(rulesRead.value);
    config = { ...base, ...parsed };
  }
  project.hasFiles = grantsRead.kind !== 'absent' || counters.present || rulesRead.kind !== 'absent';
  return { project, grants, hidden, counters: counters.sessions, config, problems };
}

async function buildOverview(options: GuardrailsOptions, source: OwnedSource): Promise<GuardrailsOverviewDto> {
  const now = Date.now();
  const discovery = await discover(options, source, now);
  const [killSwitch, reads] = await Promise.all([readKillSwitch(homeOf(options)), Promise.all(discovery.projects.map((project) => readProject(project, now)))]);
  const grants: GrantDto[] = reads.flatMap((read) =>
    read.grants.map((grant) => ({
      id: grant.id,
      category: grant.category,
      mode: grant.mode,
      expiresAt: grant.expiresAt,
      remainingMs: Math.max(0, grant.expiresAt - now),
      sessionId: grant.sessionId,
      sessionName: sessionNameById(discovery.sessions, grant.sessionId),
      project: read.project.path,
      rationale: grant.rationale,
      used: grant.used,
      maxUses: grant.maxUses,
    })),
  );
  grants.sort((a, b) => a.expiresAt - b.expiresAt);
  const sessions: SessionBlocksDto[] = reads
    .flatMap((read) => read.counters.map((counter) => ({ read, counter })))
    .filter(({ counter }) => counter.total > 0 || counter.refusedCount > 0 || counter.timeoutUntil !== null)
    .map(({ read, counter }) => ({
      sessionId: counter.sessionId,
      prefix: counter.sessionId.slice(0, 8),
      sessionName: sessionNameById(discovery.sessions, counter.sessionId),
      project: read.project.path,
      blocks: counter.blocks,
      total: counter.total,
      refusedCount: counter.refusedCount,
      timeoutUntil: counter.timeoutUntil,
      lastRequestAt: counter.lastRequestAt,
    }))
    .sort((a, b) => b.total - a.total || a.sessionId.localeCompare(b.sessionId));
  return {
    ok: true,
    generatedAt: new Date(now).toISOString(),
    killSwitch,
    projects: discovery.projects,
    sourcesText: discovery.sourcesText,
    grants,
    sessions,
    configs: reads.flatMap((read) => (read.config === undefined ? [] : [read.config])),
    problems: [...discovery.problems, ...reads.flatMap((read) => read.problems), ...ambiguousPrefixProblems(reads, discovery.sessions)],
    hiddenEntries: reads.reduce((sum, read) => sum + read.hidden, 0),
    rulesNote: RULES_NOTE,
    formatVersion: FORMAT_VERSION,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /guardrails/denials[/commands]
// ---------------------------------------------------------------------------------------------------------------------------------------------------

function parseDenialQuery(query: Parameters<typeof queryValue>[0]): { day?: string; category?: string; sessionPrefix?: string; limit: number } {
  const day = queryValue(query, 'day');
  if (day !== undefined && !DAY_PATTERN.test(day)) {
    throw new RequestError(400, `'day' must be YYYY-MM-DD, got '${day.slice(0, 40)}'`, 'Pick a day of the list of the page, or leave it empty for the newest days.');
  }
  const category = queryValue(query, 'category');
  if (category !== undefined && !/^[\w.:-]{1,80}$/.test(category)) {
    throw new RequestError(400, `'category' must be a category name (letters, digits, - _ . :), got '${category.slice(0, 40)}'`, 'Pick a category of the list of the page.');
  }
  const session = queryValue(query, 'session')?.toLowerCase();
  if (session !== undefined && !/^[0-9a-f]{1,8}$/.test(session)) {
    throw new RequestError(400, `'session' must be 1 to 8 hexadecimal characters (the start of a session id), got '${session.slice(0, 40)}'`, 'Use the first 8 characters of the session id, as the journal writes them.');
  }
  const rawLimit = queryValue(query, 'limit');
  const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RequestError(400, `'limit' must be a whole number from 1 to ${MAX_LIMIT}, got '${String(rawLimit).slice(0, 20)}'`, `Use ?limit=${DEFAULT_LIMIT} or less.`);
  }
  return { ...(day === undefined ? {} : { day }), ...(category === undefined ? {} : { category }), ...(session === undefined ? {} : { sessionPrefix: session }), limit };
}

async function buildDenials(options: GuardrailsOptions, query: Parameters<typeof queryValue>[0], withCommands: boolean): Promise<DenialsDto> {
  const parsed = parseDenialQuery(query);
  const tail = await readJournalTail(journalDirOf(homeOf(options)), { ...parsed, budgetBytes: options.journalBudgetBytes ?? DEFAULT_BUDGET_BYTES });
  const problems = [...tail.problems];
  // Names are a convenience: the registry failing is said, the denials stay.
  let sessions: Session[] = [];
  const registry = await readSessionRegistry(resolveSessionsDir(process.env));
  if (registry.ok) {
    sessions = registry.sessions;
  } else {
    const { message, hint } = registry.error;
    problems.push(problem(resolveSessionsDir(process.env), `The session registry cannot be read, so session names are missing: ${message}`, hint));
  }
  const denials: DenialDto[] = tail.records.map((record) => ({
    at: record.at,
    day: record.day,
    session: record.session,
    prefix: record.prefix,
    sessionName: sessionNameByPrefix(sessions, record.prefix),
    decision: record.decision,
    category: record.category,
    project: record.project,
    tool: record.tool,
    file: record.file,
    hasCommand: record.command !== null,
    ...(withCommands && record.command !== null ? { command: record.command } : {}),
  }));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    denials,
    days: tail.days,
    categories: tail.categories,
    filter: { day: parsed.day ?? '', category: parsed.category ?? '', session: parsed.sessionPrefix ?? '', limit: parsed.limit },
    truncated: tail.truncated,
    bytesRead: tail.bytesRead,
    skipped: tail.skipped,
    withCommands,
    note: NOTE_UNMASKED,
    problems,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * GET /guardrails/overview: grants, per-session counters, rules as written, kill switch, the folders scanned and the files it could not read.
 * Not sensitive (no PIN, like GET /sessions): it holds categories, counts, expiries, session ids and a rationale cut to 160 characters, never a command.
 * GET /guardrails/denials: the journal tail WITHOUT the command texts. GET /guardrails/denials/commands: the same with them, SENSITIVE (PIN): a blocked
 * command is by nature a risky one and the journal keeps 500 unmasked characters of it, so it may hold a token; any local process can call an unprotected
 * GET (research/guardrails-management.md, G-1).
 */
export function registerGuardrailsRoutes(kit: RouteKit, options: GuardrailsOptions, source: OwnedSource): void {
  kit.route('GET', '/guardrails/overview', async () => ok(await buildOverview(options, source)));
  kit.route('GET', '/guardrails/denials', async (req) => ok(await buildDenials(options, req.query, false)));
  kit.route('GET', '/guardrails/denials/commands', async (req) => ok(await buildDenials(options, req.query, true)), { sensitive: true });
  registerGrantsRoutes(kit, options, source);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The chip of the session rows
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * What the Agents list says about the guardrails: for each session, the counters of the plugin in ITS folder (matched on the first 8 characters of the id,
 * the full id first). Never throws: a state file that cannot be read is `errorText` (shown on the page), the rows stay.
 */
export async function guardrailBlocksFor(rows: readonly { sessionId: string; cwd: string }[], now: number): Promise<{ byId: Map<string, GuardrailBlocksDto>; errorText: string }> {
  const byId = new Map<string, GuardrailBlocksDto>();
  const folders = new Map<string, string>();
  let refused = 0;
  let ambiguous = 0;
  for (const row of rows) {
    const project = localProject(row.cwd);
    if (project === undefined) {
      refused += 1;
    } else {
      folders.set(dedupeKey(project), project);
    }
  }
  const problems: GuardrailsProblem[] = [];
  try {
    const counters = new Map<string, RawSessionBlocks[]>();
    await Promise.all(
      [...folders.entries()].map(async ([key, project]) => {
        const read = await readCounters(project, now);
        problems.push(...read.problems);
        counters.set(key, read.sessions);
      }),
    );
    // Two sessions that start with the same 8 characters cannot be told apart by a short prefix: such a session gets an exact match or no chip, never a guess.
    const idsByPrefix = new Map<string, Set<string>>();
    for (const row of rows) {
      const prefix = row.sessionId.toLowerCase().slice(0, 8);
      idsByPrefix.set(prefix, (idsByPrefix.get(prefix) ?? new Set()).add(row.sessionId.toLowerCase()));
    }
    for (const row of rows) {
      const project = localProject(row.cwd);
      const sessions = project === undefined ? [] : (counters.get(dedupeKey(project)) ?? []);
      const id = row.sessionId.toLowerCase();
      const prefix = id.slice(0, 8);
      let match = sessions.find((session) => session.sessionId.toLowerCase() === id);
      if (match === undefined) {
        const candidates = sessions.filter((session) => session.sessionId.toLowerCase().slice(0, 8) === prefix);
        if (candidates.length === 1 && (idsByPrefix.get(prefix)?.size ?? 0) === 1) {
          match = candidates[0];
        } else if (candidates.length > 0) {
          ambiguous += 1;
        }
      }
      if (match !== undefined && (match.total > 0 || match.timeoutUntil !== null)) {
        byId.set(id, { total: match.total, categories: match.blocks, timeout: match.timeoutUntil !== null });
      }
    }
  } catch (error) {
    return { byId, errorText: `The guardrail counters could not be read: ${getErrorMessage(error)}. The chips are missing; open the Guardrails page for details.` };
  }
  const parts: string[] = [];
  if (problems.length > 0) {
    parts.push(`${problems.length} guardrail file(s) cannot be read, so some chips are missing: ${problems[0]!.file} ${problems[0]!.message}. See the Guardrails page.`);
  }
  if (refused > 0) {
    parts.push(`${refused} session(s) work in a folder that is not a local path: their guardrail counters are not read.`);
  }
  if (ambiguous > 0) {
    parts.push(`${ambiguous} session(s) share an 8-character id prefix with another session: no guardrail chip is shown for them (ambiguous session prefix). See the Guardrails page.`);
  }
  return { byId, errorText: parts.join(' ') };
}

/**
 * A counter whose session id starts with the same 8 characters as another session of the registry: the journals carry only those 8 characters, so a denial of
 * the journal cannot be attributed to one of them. Listed (never guessed), the chip of the Agents list is not shown for them.
 */
function ambiguousPrefixProblems(reads: readonly ProjectRead[], sessions: readonly Session[]): GuardrailsProblem[] {
  const found: GuardrailsProblem[] = [];
  for (const read of reads) {
    for (const counter of read.counters) {
      const prefix = counter.sessionId.toLowerCase().slice(0, 8);
      const sharing = sessions.filter((session) => session.sessionId.toLowerCase().startsWith(prefix) && session.sessionId.toLowerCase() !== counter.sessionId.toLowerCase());
      if (sharing.length > 0 && counter.total > 0) {
        found.push(problem(countersFileOf(read.project.path), `ambiguous session prefix ${prefix}: the counters of ${counter.sessionId} share their first 8 characters with ${sharing.length} other session(s) of the registry`, 'The denial journal only has those 8 characters, so its rows cannot be attributed to one session. The Agents list shows no chip for them; the exact counters stay in this page.'));
      }
    }
  }
  return found;
}
