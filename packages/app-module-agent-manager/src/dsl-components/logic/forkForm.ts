import { forkNameOf } from '../shared.js';
import type { ModelDto, OwnedForkRequest, SessionRowDto } from '../shared.js';
import { MODEL_OPTIONS } from './launchForm.js';

/** What a fork of a session is, in one place for the dialog and the button (research/session-fork.md). */
export const FORK_MEANING = 'Opens a new Web session in the same folder that continues a copy of this conversation. The original is not changed and keeps running.';

/** "fork of <name>": the same helper as the route (cleaned, within the length the daemon accepts). */
export function forkNameDefault(session: Pick<SessionRowDto, 'displayName'>): string {
  return forkNameOf(session.displayName);
}

/**
 * The alias (`--model haiku`) of the family of a model the row shows, '' when the family is not one of the aliases of the dialog. An alias means "the latest of
 * that family", which may differ from the exact model of the source: the dialog says so, and an owned source gives its exact launch value instead.
 */
export function modelAliasOf(model: Pick<ModelDto, 'id' | 'displayName'> | undefined): string {
  if (model === undefined) {
    return '';
  }
  const text = `${model.id ?? ''} ${model.displayName}`.toLowerCase();
  return MODEL_OPTIONS.map((option) => option.value).find((alias) => alias !== '' && text.includes(alias)) ?? '';
}

/**
 * Why a session cannot be forked, undefined when it can. A session that has no registry file yet has no message, so no transcript: Claude Code has nothing to
 * continue (the daemon refuses it with the same reason, this says it before the click).
 */
export function forkBlockedReason(session: Pick<SessionRowDto, 'registryPending' | 'cwd'>): string | undefined {
  if (session.registryPending === true) {
    return 'This session has no message yet, so there is no conversation to fork. Send it a message first.';
  }
  if (session.cwd === '') {
    return 'This session has no working folder in the registry, so a fork would not know where to start.';
  }
  return undefined;
}

/** The warning of a source that is working or waits for an answer: the fork starts from what is written so far. */
export function forkBusyWarning(session: Pick<SessionRowDto, 'state' | 'ownedState'>): string | undefined {
  const busy = session.state === 'working' || session.state === 'needs-you' || session.ownedState === 'running' || session.ownedState === 'requires_action';
  return busy
    ? 'This agent is working now. The fork starts from the transcript as written so far: the turn in flight (and a permission request it waits on) is not part of it, and the original keeps going.'
    : undefined;
}

export interface ForkForm {
  sourceSessionId: string;
  name: string;
  model: string;
  permissionMode: string;
}

/** The body of POST /owned/fork: only the fields that have a value. */
export function forkBody(form: ForkForm): OwnedForkRequest {
  const name = form.name.trim();
  const model = form.model.trim();
  const permissionMode = form.permissionMode.trim();
  return { sourceSessionId: form.sourceSessionId, ...(name === '' ? {} : { name }), ...(model === '' ? {} : { model }), ...(permissionMode === '' ? {} : { permissionMode }) };
}
