import { defaultConfigDir, getErrorMessage } from '@wadeck-app/agent-manager-core';
import { GRANT_MODES, MAX_RATIONALE_CHARS, type GrantAddedDto, type GrantModeDto, type RuleCategoryDto, type SessionRulesDto } from '../commons/guardrails.js';
import { CodedRequestError, fail, shaped } from './apiError.js';
import type { OwnedSource } from './daemon/ownedSource.js';
import { GuardrailsAdminError, grantBypass, listRules, type AdminRulesResult } from './guardrailsAdmin.js';
import { adminCallOf, errorText, folderOf, statusOf, withAuditProblem, writeAudit, type GrantsOptions } from './guardrailsGrantsRoutes.js';
import { ok, queryValue, type RouteAnswer, type RouteKit, type RouteRequest } from './routeKit.js';
import { findSession } from './sessionLookup.js';

/*
 * Add a bypass for ONE session, and the rules of the plugin for its folder. Threat-model T-23.
 *   POST /guardrails/sessions/:sessionId/grants   {category, mode, rationale}: PIN-sensitive and CSRF, listed in commons/routeClasses.ts
 *   GET  /guardrails/sessions/:sessionId/rules    read-only, no PIN
 * The PIN gate of app-core ran before the handler; the handler still needs the user's access token (the Authorization header the shell fetcher sent) because the
 * plugin's CLI verifies it itself against app-core. The token goes to the CLI's stdin and nowhere else (guardrailsAdmin.ts); this file never logs, audits or answers it.
 * The folder is never sent by the caller: it is the session's current folder, as for the list and the revoke.
 */

/** The access token of the user: printable ASCII, no space, a sane length (a JWT is about 300 characters). */
const BEARER = /^Bearer ([\x21-\x7e]{1,4096})$/;
/** A category name of the plugin: lower-case words joined by hyphens. */
const CATEGORY = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** After a grant the same request is refused for this long (a double click arrives after the first answer, too). */
const DUPLICATE_WINDOW_MS = 3000;

function bearerOf(req: RouteRequest): string {
  const header = req.headers?.['authorization'];
  const value = typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
  if (value === undefined) {
    throw new CodedRequestError(
      400,
      'pin-token-missing',
      'The request carries no PIN access token (an Authorization header of the form "Bearer <token>"), so nothing was granted',
      'Use the Agents page: it asks for the PIN and sends the token itself. A bypass is never granted without it.',
    );
  }
  return value;
}

/** True for a character that has no place in a one-line text: C0 and C1 controls, line and paragraph separators. */
function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

interface AddBody {
  category: string;
  mode: GrantModeDto;
  rationale: string;
}

function parseAddBody(body: unknown): AddBody {
  const example = '{"category": "rm", "mode": "once", "rationale": "why"}';
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new CodedRequestError(400, 'bad-request', 'The body must be a JSON object', `Send ${example} with Content-Type: application/json.`);
  }
  const extra = Object.keys(body).filter((key) => !['category', 'mode', 'rationale'].includes(key));
  if (extra.length > 0) {
    throw new CodedRequestError(400, 'bad-request', `Unknown field(s) in the body: ${extra.map((key) => `'${key.slice(0, 40)}'`).join(', ')}`, `The fields are category, mode and rationale, e.g. ${example}. The folder and the session come from the URL, never from the body.`);
  }
  const category: unknown = Reflect.get(body, 'category');
  const mode: unknown = Reflect.get(body, 'mode');
  const rationale: unknown = Reflect.get(body, 'rationale');
  if (typeof category !== 'string' || !CATEGORY.test(category)) {
    throw new CodedRequestError(400, 'bad-request', `'category' must be a category name (lower-case letters, digits and hyphens), got ${JSON.stringify(category)?.slice(0, 60)}`, 'Use a name of GET /guardrails/sessions/:sessionId/rules.');
  }
  if (typeof mode !== 'string' || !(GRANT_MODES as readonly string[]).includes(mode)) {
    throw new CodedRequestError(400, 'bad-request', `'mode' must be one of ${GRANT_MODES.join(', ')}, got ${JSON.stringify(mode)?.slice(0, 40)}`, 'once is one use, the others are time-boxed.');
  }
  if (typeof rationale !== 'string' || rationale.trim() === '') {
    throw new CodedRequestError(400, 'bad-request', "'rationale' must be a non-empty text: the plugin journal keeps it", 'Say in one line why this bypass is needed.');
  }
  if ([...rationale].length > MAX_RATIONALE_CHARS) {
    throw new CodedRequestError(400, 'bad-request', `'rationale' has ${[...rationale].length} characters, the limit is ${MAX_RATIONALE_CHARS}`, 'Shorten it to one line.');
  }
  if ([...rationale].some(isControl)) {
    throw new CodedRequestError(400, 'bad-request', "'rationale' must be plain text on one line: it has a line break or a control character", 'Remove the line breaks and control characters.');
  }
  return { category, mode: mode as GrantModeDto, rationale: rationale.trim() };
}

interface Explained {
  status: number;
  code: string;
  message: string;
  hint: string;
}

/** The user-facing text of a refusal of the CLI. The plugin's own words are kept after "The plugin said:". */
function explain(failure: GuardrailsAdminError): Explained {
  const said = getErrorMessage(failure);
  const original = `The plugin said: ${said.slice(0, 400)}`;
  if (failure.code === 'plugin-error') {
    if (/elevation-required|older than 10 min|\blocked\b/i.test(said)) {
      return { status: 409, code: 'pin-expired', message: 'The PIN was entered more than 10 minutes ago: enter it again and retry', hint: `The PIN may also be locked after wrong attempts. Retry the action and type the PIN when asked. ${original}` };
    }
    if (/pin-not-set|no pin\b/i.test(said)) {
      return { status: 409, code: 'pin-not-set', message: 'No PIN is set in app-core, so the plugin cannot check who asks', hint: `Run 'app-core-cli pin set' once in a terminal, then retry. ${original}` };
    }
    if (/unreachable|stale port|ECONNREFUSED|timed out|timeout/i.test(said)) {
      return { status: 502, code: 'app-core-unreachable', message: 'The plugin could not reach app-core to check the PIN', hint: `Check that app-core is running (restart it if its port file is stale), then retry. ${original}` };
    }
    if (/not bypassable|cannot be bypassed|not-bypassable/i.test(said)) {
      return { status: 409, code: 'not-bypassable', message: 'The plugin says this category cannot be bypassed', hint: `No bypass can lift it. ${original}` };
    }
    if (/spam/i.test(said)) {
      return { status: 409, code: 'spam-lock', message: 'The plugin refuses new bypasses for this session for a moment: too many requests', hint: `Wait a minute and retry. ${original}` };
    }
    return { status: 502, code: 'plugin-error', message: said, hint: 'Fix what the message says, then retry.' };
  }
  return { status: statusOf(failure.code), code: failure.code, message: said, hint: failure.hint === '' ? 'Refresh the list and retry.' : failure.hint };
}

/** Why a category cannot be granted, in words: the plugin owns the reason, the module reports what the rules say. */
function notBypassableText(rule: RuleCategoryDto): string {
  const why = rule.hardcoded || rule.source === 'hardcoded' ? 'it is hardcoded in the plugin' : `the plugin marks it as not bypassable (source: ${rule.source}, decision: ${rule.decision})`;
  return `'${rule.name}' cannot be bypassed: ${why}`;
}

export function registerAddRoutes(kit: RouteKit, options: GrantsOptions, owned: OwnedSource): void {
  const configDirOf = (): string => options.configDir ?? defaultConfigDir(process.env);
  // Double-submit protection: a request for the same session and category while one runs (or just succeeded) is refused. A failure frees the key at once.
  const running = new Set<string>();
  const granted = new Map<string, number>();

  kit.route('GET', '/guardrails/sessions/:sessionId/rules', async (req) => {
    queryValue(req.query, 'inlineErrors');
    const found = await findSession(req.params?.['sessionId'], owned);
    const empty = (sessionId: string, cwd: string, cwdNote: string, code: string, text: string): RouteAnswer => ok({ ok: false, code, sessionId, cwd, cwdNote, configPath: '', configPresent: false, configError: '', categories: [], errorText: text } satisfies SessionRulesDto);
    if ('registryError' in found) {
      return empty(req.params?.['sessionId'] ?? '', '', '', 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}. ${found.registryError.hint}`);
    }
    const { session } = found;
    const folder = await folderOf(session);
    if (folder.cwd === '') {
      return empty(session.sessionId, '', '', 'no-cwd', 'The folder of this session is unknown (neither the registry nor the transcript give one), so the plugin cannot be asked. Send a message in the session so that Claude Code reports it, then refresh.');
    }
    try {
      const rules = await listRules({ ...adminCallOf(options), cwd: folder.cwd });
      return ok({
        ok: true,
        code: '',
        sessionId: session.sessionId,
        cwd: folder.cwd,
        cwdNote: folder.note,
        configPath: rules.config.path ?? '',
        configPresent: rules.config.present,
        configError: rules.config.error ?? '',
        categories: rules.categories,
        errorText: '',
      } satisfies SessionRulesDto);
    } catch (error) {
      if (error instanceof GuardrailsAdminError) {
        return empty(session.sessionId, folder.cwd, folder.note, error.code, errorText(error));
      }
      throw error;
    }
  });

  kit.route(
    'POST',
    '/guardrails/sessions/:sessionId/grants',
    shaped(async (req) => {
      // The token first: without it nothing else is looked at, and it is the only place it is read from.
      const token = bearerOf(req);
      const body = parseAddBody(req.body);
      const found = await findSession(req.params?.['sessionId'], owned);
      if ('registryError' in found) {
        return fail(409, 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}`, found.registryError.hint);
      }
      const { session } = found;
      const folder = await folderOf(session);
      if (folder.cwd === '') {
        return fail(409, 'no-cwd', `The folder of session ${session.sessionId} is unknown, so nothing was granted`, 'Send a message in the session so that Claude Code reports its folder, then retry.');
      }
      const key = `${session.sessionId}|${body.category}`;
      const recent = granted.get(key);
      if (running.has(key) || (recent !== undefined && Date.now() - recent < DUPLICATE_WINDOW_MS)) {
        return fail(409, 'duplicate-request', `A ${body.category} bypass for this session is already being made or was made a moment ago`, 'Refresh the list of bypasses: the first request is the one that counts.');
      }
      running.add(key);
      let made = false;
      const audit = async (id: string, outcome: string): Promise<string> =>
        writeAudit(configDirOf(), { time: Date.now(), kind: 'bypass-grant', sessionId: session.sessionId, id, category: body.category, cwd: folder.cwd, outcome, mode: body.mode, rationale: body.rationale }, 'The bypass state is as the plugin left it');
      try {
        const rules: AdminRulesResult = await listRules({ ...adminCallOf(options), cwd: folder.cwd });
        const rule = rules.categories.find((candidate) => candidate.name === body.category);
        if (rule === undefined) {
          const message = `The plugin has no category '${body.category}' for ${folder.cwd}`;
          const problem = await audit('', `refused: unknown-category: ${message}`);
          const names = rules.categories.filter((candidate) => candidate.bypassable).map((candidate) => candidate.name);
          return fail(400, 'unknown-category', message, withAuditProblem(`Bypassable categories: ${names.slice(0, 20).join(', ')}${names.length > 20 ? `, and ${names.length - 20} more` : ''}.`, problem));
        }
        if (!rule.bypassable) {
          const message = notBypassableText(rule);
          const problem = await audit('', `refused: not-bypassable: ${message}`);
          return fail(409, 'not-bypassable', message, withAuditProblem('No bypass can lift it; only a person can change it in the plugin configuration.', problem));
        }
        const result = await grantBypass({ ...adminCallOf(options), cwd: folder.cwd, sessionId: session.sessionId, category: body.category, mode: body.mode, rationale: body.rationale, token });
        granted.set(key, Date.now());
        made = true;
        const auditError = await audit(result.id, 'granted');
        return ok({ ok: true, id: result.id, category: result.category, mode: body.mode, sessionId: session.sessionId, cwd: folder.cwd, expiresAt: Date.parse(result.expires), origin: result.origin, auditError } satisfies GrantAddedDto);
      } catch (error) {
        if (error instanceof GuardrailsAdminError) {
          const explained = explain(error);
          // Not installed: nothing ran, so there is nothing to audit. The audit line holds the code and the (token-free) message, cut.
          const problem = error.code === 'not-installed' ? '' : await audit('', `failed: ${explained.code}: ${getErrorMessage(error)}`.slice(0, 500));
          return fail(explained.status, explained.code, explained.message, withAuditProblem(explained.hint, problem));
        }
        throw error;
      } finally {
        running.delete(key);
        if (!made) {
          granted.delete(key);
        }
      }
    }),
    { sensitive: true },
  );
}
