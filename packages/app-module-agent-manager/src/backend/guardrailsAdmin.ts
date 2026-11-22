import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import type { GrantModeDto } from '../commons/guardrails.js';

/*
 * The management CLI of the w-guardrails plugin (scripts/admin.js): list and revoke the bypasses of a session. The module never reads or writes the
 * plugin's state files for this: it runs the plugin's own script (threat-model T-22) with `process.execPath` and an argv array (no shell), and parses
 * its JSON strictly. Contract (from the plugin owner, plugin >= 1.29.0):
 *   node admin.js bypass list   --cwd <dir> [--session <fullid>] --json   -> {"schema":"w-guardrails.bypass-list/1", cwd, now, grants:[...]}
 *   node admin.js bypass revoke --id <id> --cwd <dir> --json              -> {"schema":"w-guardrails.bypass-revoke/1", revoked:true, id, category, session_id}
 *   bypass grant  --cwd <dir> --category <c> --mode once|10m|30m|4h --session <fullid> --rationale <text> --json, the PIN access token (the Bearer VALUE) on STDIN
 *                                                                         -> {"schema":"w-guardrails.bypass-grant/1", granted:true, id, category, mode, session_id, expires, origin:"ui"}
 *   rules --cwd <dir> --json -> {"schema":"w-guardrails.rules/1", cwd, config:{path,present,error}, categories:[{name,decision,source,bypassable,hardcoded}]}
 *   exit 1 -> {"schema":"w-guardrails.error/1","error":"..."}; exit 2 -> usage error (flags are strict per command).
 * The token (threat-model T-23) is written to the child's stdin and nowhere else: not in argv, not in the environment (the child inherits process.env as it is), not in a
 * message: whatever the plugin prints is cleaned of it before it becomes an error text.
 */

/** The environment variable that replaces the search of the plugin folder. FOR TESTS ONLY (a fake script): never set it for real use. */
export const adminOverrideEnv = 'AGENT_MANAGER_GUARDRAILS_ADMIN';

const LIST_SCHEMA = 'w-guardrails.bypass-list/1';
const REVOKE_SCHEMA = 'w-guardrails.bypass-revoke/1';
const GRANT_SCHEMA = 'w-guardrails.bypass-grant/1';
const RULES_SCHEMA = 'w-guardrails.rules/1';
const ERROR_SCHEMA = 'w-guardrails.error/1';

/** One call may take this long before it is killed. */
export const ADMIN_TIMEOUT_MS = 10_000;
/** Bytes of stdout accepted (the list is bounded by the 24 h expiry and the 64 KB state file: anything bigger is not the contract). */
export const ADMIN_MAX_STDOUT_BYTES = 1024 * 1024;
/** Bytes of the end of stderr kept for the message. */
const STDERR_TAIL_BYTES = 2000;

export type AdminErrorCode =
  /** No plugin folder, no admin.js in the newest version, or the override points nowhere: the page may fall back to reading the files. */
  | 'not-installed'
  | 'spawn-failed'
  | 'timeout'
  | 'output-too-large'
  /** stdout is not the contract (not JSON, no or unknown schema, a field of the wrong type, an answer for another id). */
  | 'bad-output'
  /** exit 1: the plugin refused and said why. */
  | 'plugin-error'
  /** exit 2: the module and the plugin disagree on the flags. */
  | 'usage'
  | 'exit-code';

export class GuardrailsAdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message: string,
    readonly hint: string,
    readonly stderrTail: string = '',
  ) {
    super(message);
    this.name = 'GuardrailsAdminError';
  }
}

export interface AdminGrant {
  id: string;
  category: string;
  mode: 'once' | 'ttl';
  /** The FULL session id. */
  sessionId: string;
  /** ISO text, as the plugin wrote it. */
  expires: string;
  remainingMs: number;
  /** Uses left of a "once" grant, null for a time-boxed one. */
  usesLeft: number | null;
  reason: string;
  /** Who made the grant: 'ui' for one made through the admin CLI with a PIN token, anything else the plugin says, null when the entry has no origin (an older grant). */
  origin: string | null;
}

export interface AdminListResult {
  /** The folder the plugin used (as it resolved it). */
  cwd: string;
  now: string;
  grants: AdminGrant[];
}

export interface AdminRevokeResult {
  id: string;
  category: string;
  sessionId: string;
}

export type GrantMode = GrantModeDto;

export interface AdminGrantResult {
  /** The base id (git-commit-push writes two entries and answers the first). */
  id: string;
  category: string;
  mode: string;
  sessionId: string;
  expires: string;
  origin: string | null;
}

export type RuleDecision = 'allow' | 'ask' | 'deny';
export type RuleSource = 'default' | 'config' | 'hardcoded';

export interface AdminRule {
  name: string;
  decision: RuleDecision;
  source: RuleSource;
  bypassable: boolean;
  hardcoded: boolean;
}

export interface AdminRulesResult {
  cwd: string;
  config: { path: string | null; present: boolean; error: string | null };
  categories: AdminRule[];
}

interface CallOptions {
  /** The admin.js to run. Default: resolveAdminScript(). */
  script?: string;
  /** The home folder that holds .claude/plugins. Default: the user's home. */
  homeDir?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Where the script is
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** The plugin folder that holds one folder per version. */
export function pluginFolderOf(homeDir: string): string {
  return join(homeDir, '.claude', 'plugins', 'cache', 'local-marketplace', 'w-guardrails');
}

/** -1, 0, 1 by numeric comparison of the dot-separated parts (1.29.0 > 1.9.0). */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }
  return 0;
}

const VERSION_NAME = /^\d+(\.\d+)*$/;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The path of scripts/admin.js of the highest installed version of the plugin, or the explicit error saying why there is none. */
export function resolveAdminScript(options: { homeDir?: string } = {}): string {
  const override = process.env[adminOverrideEnv];
  if (override !== undefined && override !== '') {
    if (!isFile(override)) {
      throw new GuardrailsAdminError('not-installed', `${adminOverrideEnv} is set to '${override}', which is not a file`, `Unset ${adminOverrideEnv} (it is for tests only) or point it to a script.`);
    }
    return override;
  }
  const folder = pluginFolderOf(options.homeDir ?? homedir());
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    throw new GuardrailsAdminError('not-installed', `w-guardrails is not installed (looked in ${folder})`, 'Install the w-guardrails plugin (version 1.29.0 or later has the admin CLI), then reload this page.');
  }
  const versions = names.filter((name) => VERSION_NAME.test(name)).sort(compareVersions);
  const newest = versions[versions.length - 1];
  if (newest === undefined) {
    throw new GuardrailsAdminError('not-installed', `w-guardrails is not installed (looked in ${folder}: no version folder)`, 'Install the w-guardrails plugin (version 1.29.0 or later has the admin CLI), then reload this page.');
  }
  const script = join(folder, newest, 'scripts', 'admin.js');
  if (!isFile(script)) {
    throw new GuardrailsAdminError('not-installed', `w-guardrails ${newest} has no scripts/admin.js (looked in ${join(folder, newest)})`, 'Update the w-guardrails plugin to 1.29.0 or later (the admin CLI), then reload this page.');
  }
  return script;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------------------------------------------------------------------------------

interface RawRun {
  code: number;
  stdout: string;
  stderr: string;
}

function run(script: string, args: readonly string[], timeoutMs: number, maxStdoutBytes: number, stdin?: string): Promise<RawRun> {
  return new Promise((resolve, reject) => {
    // No shell: the arguments reach the script as they are. windowsHide: no console flashes on Windows. stdin is always a pipe: closed at once (nothing to read, like /dev/null) or written once (the token).
    const child = spawn(process.execPath, [script, ...args], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    // A child that ends before reading it (a refusal) closes the pipe: its exit code and JSON say why, so an EPIPE here is not news.
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin);
    const out: Buffer[] = [];
    let outBytes = 0;
    let errTail = Buffer.alloc(0);
    let settled = false;
    const finish = (action: () => void): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        action();
      }
    };
    const tail = (): string => errTail.toString('utf8').trim();
    // violations-suppress: app-module/no-raw-timers one call-local timer, at most 10 s, cleared on every way out of the promise: nothing outlives the call
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new GuardrailsAdminError('timeout', `The w-guardrails admin CLI did not answer within ${timeoutMs / 1000} s and was stopped`, 'Run the command yourself to see where it blocks; another process may hold the bypass lock. Retry in a few seconds.', tail())));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > maxStdoutBytes) {
        child.kill('SIGKILL');
        finish(() => reject(new GuardrailsAdminError('output-too-large', `The w-guardrails admin CLI wrote more than ${maxStdoutBytes / 1024 / 1024} MiB and was stopped`, 'This is not the documented output. Update the w-guardrails plugin and agent-manager to matching versions.', tail())));
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errTail = Buffer.concat([errTail, chunk]).subarray(-STDERR_TAIL_BYTES);
    });
    child.on('error', (error) => {
      finish(() => reject(new GuardrailsAdminError('spawn-failed', `The w-guardrails admin CLI could not be started: ${getErrorMessage(error)}`, `Check that '${process.execPath}' can run '${script}'.`)));
    });
    child.on('close', (code, signal) => {
      finish(() => resolve({ code: code ?? (signal === null ? -1 : -2), stdout: Buffer.concat(out).toString('utf8'), stderr: tail() }));
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const UPDATE_HINT = 'Update the w-guardrails plugin and agent-manager to matching versions, then reload this page.';

function badOutput(message: string, stderr: string): GuardrailsAdminError {
  return new GuardrailsAdminError('bad-output', `The w-guardrails admin CLI answered something that is not its contract: ${message}`, UPDATE_HINT, stderr);
}

function parseJson(text: string, stderr: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw badOutput(`stdout is not JSON (starts with ${JSON.stringify(text.trim().slice(0, 60))})`, stderr);
  }
  if (!isRecord(value)) {
    throw badOutput('stdout is JSON but not an object', stderr);
  }
  return value;
}

/** The text without the secret, whether it is written raw or as inside a JSON string. */
function withoutSecret(value: string, secret: string): string {
  const escaped = JSON.stringify(secret).slice(1, -1);
  return value.split(secret).join('[token removed]').split(escaped).join('[token removed]');
}

/** Runs one command and returns the parsed JSON of a success; every other outcome is a GuardrailsAdminError. `schema` is the expected one. */
async function call(options: CallOptions, args: readonly string[], schema: string, secretInput?: string): Promise<Record<string, unknown>> {
  const script = options.script ?? resolveAdminScript(options.homeDir === undefined ? {} : { homeDir: options.homeDir });
  const raw = await run(script, args, options.timeoutMs ?? ADMIN_TIMEOUT_MS, options.maxStdoutBytes ?? ADMIN_MAX_STDOUT_BYTES, secretInput);
  // Nothing the plugin printed may carry the secret into an error text, a log or a response (it could echo what it was given).
  const result = secretInput === undefined ? raw : { code: raw.code, stdout: withoutSecret(raw.stdout, secretInput), stderr: withoutSecret(raw.stderr, secretInput) };
  if (result.code === 1) {
    const body = (() => {
      try {
        return parseJson(result.stdout, result.stderr);
      } catch {
        return undefined;
      }
    })();
    if (body !== undefined && body['schema'] === ERROR_SCHEMA && typeof body['error'] === 'string') {
      throw new GuardrailsAdminError('plugin-error', body['error'], 'Fix what the message says (the plugin owns that file), then reload this page.', result.stderr);
    }
    throw new GuardrailsAdminError('exit-code', `The w-guardrails admin CLI ended with exit code 1 without its error JSON${result.stderr === '' ? '' : `: ${result.stderr.slice(-300)}`}`, `Run \`node ${script} ...\` yourself to see the failure. ${UPDATE_HINT}`, result.stderr);
  }
  if (result.code === 2) {
    throw new GuardrailsAdminError('usage', `The w-guardrails admin CLI refused the command (exit code 2, usage error)${result.stderr === '' ? '' : `: ${result.stderr.slice(0, 200).trim()}`}`, UPDATE_HINT, result.stderr);
  }
  if (result.code !== 0) {
    throw new GuardrailsAdminError('exit-code', `The w-guardrails admin CLI ended with exit code ${result.code}, which is not in its contract (0, 1, 2)${result.stderr === '' ? '' : `: ${result.stderr.slice(-300)}`}`, `Run \`node ${script} ...\` yourself to see the failure. ${UPDATE_HINT}`, result.stderr);
  }
  const body = parseJson(result.stdout, result.stderr);
  const found = body['schema'];
  if (found === undefined) {
    throw badOutput("the answer has no 'schema' field", result.stderr);
  }
  if (found !== schema) {
    throw badOutput(`unknown schema ${JSON.stringify(found)?.slice(0, 80)}, this module reads ${JSON.stringify(schema)}`, result.stderr);
  }
  return body;
}

function text(record: Record<string, unknown>, field: string, where: string, stderr = ''): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw badOutput(`${where}'${field}' must be text, got ${JSON.stringify(value)?.slice(0, 40)}`, stderr);
  }
  return value;
}

function parseGrant(raw: unknown, index: number): AdminGrant {
  const where = `grants[${index}].`;
  if (!isRecord(raw)) {
    throw badOutput(`grants[${index}] is not an object`, '');
  }
  const id = text(raw, 'id', where);
  const category = text(raw, 'category', where);
  const mode = text(raw, 'mode', where);
  if (mode !== 'once' && mode !== 'ttl') {
    throw badOutput(`${where}'mode' must be "once" or "ttl", got ${JSON.stringify(mode).slice(0, 40)}`, '');
  }
  const sessionId = text(raw, 'session_id', where);
  const expires = text(raw, 'expires', where);
  const remaining = raw['remaining_ms'];
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) {
    throw badOutput(`${where}'remaining_ms' must be a number, got ${JSON.stringify(remaining)?.slice(0, 40)}`, '');
  }
  const usesLeft = raw['uses_left'];
  if (usesLeft !== null && (typeof usesLeft !== 'number' || !Number.isFinite(usesLeft))) {
    throw badOutput(`${where}'uses_left' must be a number or null, got ${JSON.stringify(usesLeft)?.slice(0, 40)}`, '');
  }
  const reason = text(raw, 'reason', where);
  if (id === '' || sessionId === '') {
    throw badOutput(`${where}'id' and 'session_id' must not be empty`, '');
  }
  if (Number.isNaN(Date.parse(expires))) {
    throw badOutput(`${where}'expires' is not a date: ${JSON.stringify(expires).slice(0, 60)}`, '');
  }
  // Optional field (added without a schema bump): absent or null is "unknown origin"; any other type is not the contract.
  const origin = raw['origin'];
  if (origin !== undefined && origin !== null && typeof origin !== 'string') {
    throw badOutput(`${where}'origin' must be text or null, got ${JSON.stringify(origin)?.slice(0, 40)}`, '');
  }
  return { id, category, mode, sessionId, expires, remainingMs: remaining, usesLeft, reason, origin: origin ?? null };
}

/** The bypasses the hook honours in `cwd`, for one session (its FULL id). */
export async function listBypasses(options: CallOptions & { cwd: string; sessionId: string }): Promise<AdminListResult> {
  const body = await call(options, ['bypass', 'list', '--cwd', options.cwd, '--session', options.sessionId, '--json'], LIST_SCHEMA);
  const grants = body['grants'];
  if (!Array.isArray(grants)) {
    throw badOutput(`'grants' must be a list, got ${JSON.stringify(grants)?.slice(0, 40)}`, '');
  }
  return { cwd: text(body, 'cwd', ''), now: text(body, 'now', ''), grants: grants.map((raw, index) => parseGrant(raw, index)) };
}

/** Removes ONE grant by its id. The plugin refuses --session here, so the caller checks that the grant belongs to the session before (list first). */
export async function revokeBypass(options: CallOptions & { cwd: string; id: string }): Promise<AdminRevokeResult> {
  const body = await call(options, ['bypass', 'revoke', '--id', options.id, '--cwd', options.cwd, '--json'], REVOKE_SCHEMA);
  if (body['revoked'] !== true) {
    throw badOutput(`'revoked' must be true, got ${JSON.stringify(body['revoked'])?.slice(0, 40)}`, '');
  }
  const id = text(body, 'id', '');
  if (id !== options.id) {
    throw badOutput(`it revoked ${JSON.stringify(id).slice(0, 40)} when ${JSON.stringify(options.id)} was asked`, '');
  }
  return { id, category: text(body, 'category', ''), sessionId: text(body, 'session_id', '') };
}

/**
 * Creates ONE bypass for a session. `token` is the PIN access token of the user (the Bearer VALUE, no prefix): it goes to the child's stdin and nowhere else, and the
 * CLI verifies it against app-core itself. The caller has checked that the category is bypassable (rules) and that the folder is the session's.
 * A refusal of the plugin (not bypassable, spam lock, token not accepted ...) is a 'plugin-error' with the plugin's own text.
 */
export async function grantBypass(options: CallOptions & { cwd: string; sessionId: string; category: string; mode: GrantMode; rationale: string; token: string }): Promise<AdminGrantResult> {
  if (options.token === '') {
    throw new Error('grantBypass needs the PIN access token (the Bearer value): none was given');
  }
  const args = ['bypass', 'grant', '--cwd', options.cwd, '--category', options.category, '--mode', options.mode, '--session', options.sessionId, '--rationale', options.rationale, '--json'];
  const body = await call(options, args, GRANT_SCHEMA, options.token);
  if (body['granted'] !== true) {
    throw badOutput(`'granted' must be true, got ${JSON.stringify(body['granted'])?.slice(0, 40)}`, '');
  }
  const category = text(body, 'category', '');
  const sessionId = text(body, 'session_id', '');
  const expires = text(body, 'expires', '');
  const id = text(body, 'id', '');
  if (category !== options.category || sessionId !== options.sessionId) {
    throw badOutput(`it granted ${JSON.stringify(category).slice(0, 40)} for session ${JSON.stringify(sessionId).slice(0, 40)} when ${JSON.stringify(options.category)} for ${JSON.stringify(options.sessionId)} was asked. A grant may have been created: refresh the list and revoke it if it is not wanted`, '');
  }
  if (id === '' || Number.isNaN(Date.parse(expires))) {
    throw badOutput(`the grant has no id or no valid 'expires' (${JSON.stringify(expires).slice(0, 40)}). A grant may have been created: refresh the list`, '');
  }
  const origin = body['origin'];
  if (origin !== undefined && origin !== null && typeof origin !== 'string') {
    throw badOutput(`'origin' must be text or null, got ${JSON.stringify(origin)?.slice(0, 40)}`, '');
  }
  return { id, category, mode: text(body, 'mode', ''), sessionId, expires, origin: origin ?? null };
}

const DECISIONS: readonly string[] = ['allow', 'ask', 'deny'];
const SOURCES: readonly string[] = ['default', 'config', 'hardcoded'];

function parseRule(raw: unknown, index: number): AdminRule {
  const where = `categories[${index}].`;
  if (!isRecord(raw)) {
    throw badOutput(`categories[${index}] is not an object`, '');
  }
  const name = text(raw, 'name', where);
  const decision = text(raw, 'decision', where);
  const source = text(raw, 'source', where);
  if (name === '' || !DECISIONS.includes(decision) || !SOURCES.includes(source)) {
    throw badOutput(`${where} has an empty name, a decision outside allow|ask|deny (${JSON.stringify(decision).slice(0, 30)}) or a source outside default|config|hardcoded (${JSON.stringify(source).slice(0, 30)})`, '');
  }
  const bypassable = raw['bypassable'];
  const hardcoded = raw['hardcoded'];
  if (typeof bypassable !== 'boolean' || typeof hardcoded !== 'boolean') {
    throw badOutput(`${where}'bypassable' and 'hardcoded' must be true or false`, '');
  }
  return { name, decision: decision as RuleDecision, source: source as RuleSource, bypassable, hardcoded };
}

/** The categories of the guardrails for a folder: what each one decides, where that comes from, and whether a bypass can lift it. */
export async function listRules(options: CallOptions & { cwd: string }): Promise<AdminRulesResult> {
  const body = await call(options, ['rules', '--cwd', options.cwd, '--json'], RULES_SCHEMA);
  const config = body['config'];
  const categories = body['categories'];
  if (!isRecord(config) || typeof config['present'] !== 'boolean') {
    throw badOutput("'config' must be an object with 'present' true or false", '');
  }
  const path = config['path'];
  const error = config['error'];
  if ((path !== null && path !== undefined && typeof path !== 'string') || (error !== null && error !== undefined && typeof error !== 'string')) {
    throw badOutput("'config.path' and 'config.error' must be text or null", '');
  }
  if (!Array.isArray(categories)) {
    throw badOutput(`'categories' must be a list, got ${JSON.stringify(categories)?.slice(0, 40)}`, '');
  }
  return { cwd: text(body, 'cwd', ''), config: { path: path ?? null, present: config['present'], error: error ?? null }, categories: categories.map((raw, index) => parseRule(raw, index)) };
}
