import { defaultConfigDir } from '@wadeck-app/agent-manager-core';
import { HC_APPROVAL_DECISIONS, ReplyError, createHcApproval, type HcApproval, type HcApprovalDecision } from '@wadeck-app/agent-manager-core/reply';
import type { HcPermissionDecisionOk, HcPermissionOk } from '../commons/api.js';
import { CodedRequestError, fail, shaped } from './apiError.js';
import type { OwnedSource } from './daemon/ownedSource.js';
import type { ModuleOptions } from './replyRoutes.js';
import type { RouteAnswer, RouteKit } from './routeKit.js';
import { ok } from './routeKit.js';
import { findSession } from './sessionLookup.js';

/*
 * The permission dialog of a session that runs in a herdr-core terminal, answered by typing the key into that terminal (core: HcApproval). Two routes:
 *   GET  /sessions/:sessionId/hc-permission   the dialog the terminal shows now (read only, no PIN)
 *   POST /sessions/:sessionId/hc-permission   {decision: 'allow'|'deny', promptId}: PIN-sensitive and CSRF (T-01, T-08), listed in commons/routeClasses.ts
 * Only allow ONCE and deny. "Always allow" does not exist here (it would write a standing permission rule into the project from a remote click).
 */

const PROMPT_ID = /^[0-9a-f]{16}$/;
const BODY_FIELDS = ['decision', 'promptId'];

/** Codes that are a state conflict (nothing typed, the page should read the dialog again): 409. The rest of the core codes is a failure of hc or of the disk: 502. */
const CONFLICTS = ['prompt-changed', 'already-answered', 'not-blocked', 'not-a-permission-dialog', 'dialog-not-recognized', 'no-terminal', 'ambiguous-terminal', 'terminal-gone', 'dialog-too-long'];

function statusOf(code: string): number {
  if (code === 'invalid-decision') {
    return 400;
  }
  return CONFLICTS.includes(code) ? 409 : 502;
}

function parseDecisionBody(body: unknown): { decision: HcApprovalDecision; promptId: string } {
  const example = '{"decision": "allow", "promptId": "<promptId of GET /sessions/:sessionId/hc-permission>"}';
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new CodedRequestError(400, 'bad-request', 'The body must be a JSON object', `Send ${example} with Content-Type: application/json.`);
  }
  const extra = Object.keys(body).filter((key) => !BODY_FIELDS.includes(key));
  if (extra.length > 0) {
    throw new CodedRequestError(400, 'bad-request', `Unknown field(s) in the body: ${extra.map((key) => `'${key.slice(0, 40)}'`).join(', ')}`, `The fields are decision and promptId, e.g. ${example}.`);
  }
  const decision: unknown = Reflect.get(body, 'decision');
  if (typeof decision !== 'string' || !(HC_APPROVAL_DECISIONS as readonly string[]).includes(decision)) {
    throw new CodedRequestError(400, 'invalid-decision', `'decision' must be "allow" (once) or "deny", got ${decision === undefined ? 'nothing' : JSON.stringify(decision)?.slice(0, 40)}`, "'Always allow' is never offered through the terminal: choose it in the terminal itself if you want it.");
  }
  const promptId: unknown = Reflect.get(body, 'promptId');
  if (typeof promptId !== 'string' || !PROMPT_ID.test(promptId)) {
    throw new CodedRequestError(400, 'bad-request', `'promptId' must be the 16-character id of the dialog, got ${promptId === undefined ? 'nothing' : JSON.stringify(promptId)?.slice(0, 40)}`, `Read GET /sessions/:sessionId/hc-permission first and send its promptId, e.g. ${example}.`);
  }
  return { decision: decision as HcApprovalDecision, promptId };
}

export function registerHcPermissionRoutes(kit: RouteKit, options: ModuleOptions, owned: OwnedSource): void {
  // One approval per config folder: it remembers the prompts it answered (one decision per prompt), so it lives as long as the module.
  let current: { approval: HcApproval; configDir: string } | undefined;
  const approvalOf = (): HcApproval => {
    if (options.hcApproval !== undefined) {
      return options.hcApproval;
    }
    const configDir = defaultConfigDir(process.env);
    if (current === undefined || current.configDir !== configDir) {
      current = { configDir, approval: createHcApproval({ configDir }) };
    }
    return current.approval;
  };

  function replyFailure(error: ReplyError, status: number): RouteAnswer {
    return fail(status, error.code, error.reason, error.fix);
  }

  kit.route(
    'GET',
    '/sessions/:sessionId/hc-permission',
    shaped(async (req) => {
      const found = await findSession(req.params?.['sessionId'], owned);
      if ('registryError' in found) {
        return fail(200, 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}`, found.registryError.hint);
      }
      const { session } = found;
      if (!session.alive) {
        return fail(200, 'session-dead', `The session ${session.sessionId} has ended (its process ${session.pid} is gone): there is no dialog to answer`, 'Refresh the session list.');
      }
      try {
        const state = await approvalOf().read(session);
        const sessionId = session.sessionId;
        switch (state.kind) {
          case 'prompt': {
            const { tool, ...rest } = state.prompt;
            return ok({ ok: true, sessionId, state: 'prompt', prompt: { ...rest, ...(tool === undefined ? {} : { tool }) } } satisfies HcPermissionOk);
          }
          case 'none':
            return ok({ ok: true, sessionId, state: 'none', terminal: state.terminal, status: state.status } satisfies HcPermissionOk);
          case 'unsupported':
            return ok({ ok: true, sessionId, state: 'unsupported', terminal: state.terminal, code: state.code, reason: state.reason, fix: state.fix } satisfies HcPermissionOk);
        }
      } catch (error) {
        // Data, not an error page: the card says why this session cannot be answered from here (not started in a herdr-core terminal, hc missing...).
        if (error instanceof ReplyError) {
          return replyFailure(error, 200);
        }
        throw error;
      }
    }),
  );

  kit.route(
    'POST',
    '/sessions/:sessionId/hc-permission',
    shaped(async (req) => {
      const { decision, promptId } = parseDecisionBody(req.body);
      const found = await findSession(req.params?.['sessionId'], owned);
      if ('registryError' in found) {
        return fail(409, 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}`, found.registryError.hint);
      }
      const { session } = found;
      if (!session.alive) {
        return fail(409, 'session-dead', `The session ${session.sessionId} has ended (its process ${session.pid} is gone): nothing was typed`, 'Refresh the session list.');
      }
      try {
        const result = await approvalOf().decide(session, decision, promptId);
        const body: HcPermissionDecisionOk = {
          ok: true,
          sessionId: session.sessionId,
          decision: result.decision,
          promptId: result.promptId,
          terminal: result.terminal,
          keys: result.keys,
          ...(result.tool === undefined ? {} : { tool: result.tool }),
          effect: result.effect,
          note: result.note,
          statusAfter: result.statusAfter,
        };
        return ok(body);
      } catch (error) {
        if (error instanceof ReplyError) {
          return replyFailure(error, statusOf(error.code));
        }
        throw error;
      }
    }),
    { sensitive: true },
  );
}
