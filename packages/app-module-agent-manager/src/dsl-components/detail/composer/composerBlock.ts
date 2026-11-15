import type { ReplyStatusOk } from '../deps.js';

export interface ComposerBlock {
  /** 'checking': the status is loading (no alarm); 'blocked': nothing can be sent until the user acts. */
  kind: 'checking' | 'blocked';
  /** The reason, shown in the composer in place of the text field's hint, never hidden. */
  text: string;
}

const ENDED = 'This session has ended (its process is gone), so it cannot receive messages. Start it again, or pick a living session in the list.';

/**
 * Why the composer cannot send, or undefined when it can. Visible text, not a hidden control: a dead session, a status that cannot be read, no
 * transport selected or the selected one unavailable (with the fix the server gives).
 */
export function composerBlock(input: { alive: boolean; loading: boolean; status?: ReplyStatusOk; error?: string }): ComposerBlock | undefined {
  if (!input.alive) {
    return { kind: 'blocked', text: ENDED };
  }
  const { status } = input;
  if (status === undefined) {
    return input.loading
      ? { kind: 'checking', text: 'Checking how to reach the session...' }
      : { kind: 'blocked', text: `The reply status of the session could not be read, so nothing can be sent. ${input.error ?? ''}`.trim() };
  }
  if (!status.sessionAlive) {
    return { kind: 'blocked', text: ENDED };
  }
  const selected = status.transports.find((transport) => transport.selected);
  if (selected === undefined) {
    return { kind: 'blocked', text: `No reply transport is selected (${status.selectedFrom}). Configure one with the agent-manager CLI, then reload.` };
  }
  if (!selected.available) {
    return { kind: 'blocked', text: `The ${selected.transportId} transport cannot reach this session: ${selected.reason}.${selected.fix === '' ? '' : ` ${selected.fix}`}` };
  }
  return undefined;
}
