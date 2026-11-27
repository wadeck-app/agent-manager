import { ButtonAction, IconButton, Tooltip } from '@wadeck-app/dsl-ui';
import { useState } from 'react';
import { requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { MOVE_DAEMON_DOWN, moveTipRows, switchViewOf } from '../logic/adoptSwitch.js';
import type { SwitchView } from '../logic/adoptSwitch.js';
import type { OwnedSessionDto, OwnedSwitchResponse } from '../shared.js';
import { prose } from '../logic/prose.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { useDaemonDown } from './DaemonState.js';
import { HandOverIcon } from './HandOverIcon.js';
import { ReasonList } from './ReasonList.js';

import { useUiVariant } from '../ui/UiVariants.js';
import type { OwnedChange } from '../workspace/useOwnedRows.js';

const DAEMON_DOWN_TITLE = 'The agent-manager daemon is not running, so the session cannot be handed over. Start it in a terminal: agent-manager start --detach';

export interface SwitchActionProps {
  session: AgentRow;
  disabled: boolean;
  /** The daemon's answer: the list shows the session on its new host at once. */
  onChange: (change: OwnedChange) => void;
  /** What the user must read after a successful hand-over (where it runs now, what stays to know). */
  onNote: (text: string) => void;
  /** A refusal that is not a question for the user (an untrusted folder, a daemon that is down): shown under the buttons with its hint. */
  onError: (text: string) => void;
  /** The one-line header: an icon button coloured by the readiness (its words are the accessible name and the tooltip); the badge and the daemon line are the header's. */
  compact?: boolean;
  /** The dev dock preview of the hand-over readiness: the button looks as usual but a click only says that it is a preview (nothing is sent, the daemon state does not matter). */
  previewOnly?: boolean;
}


function movedText(dto: OwnedSessionDto, target: SwitchView['target'], notes: readonly string[]): string {
  const where = target === 'hc' ? `as a Terminal session (herdr-core terminal ${dto.hcAddress ?? 'address unknown'})` : 'as a Web session';
  return [`The session was handed over and now runs ${where}: same session id, same conversation.`, ...notes].join(' ');
}

/**
 * The hand-over button of an owned session: Web <-> herdr-core terminal, same session id and conversation. Free = it hands over at once; busy or unknown = its name says
 * what is interrupted, and a click opens a dialog that lists the reasons (the "Hand over anyway" button is the only thing that sends `force`). The daemon
 * recomputes the readiness: when it finds the session not free after all, the dialog opens with ITS reasons, whatever the page showed. The button is a plain muted icon: its
 * glyph changes in a part with the readiness (the A/B question ui-switch-readiness), never its colour.
 */
export function SwitchAction({ session, disabled, onChange, onNote, onError, compact = false, previewOnly = false }: SwitchActionProps) {
  const view = switchViewOf(session);
  const readinessStyle = useUiVariant('switchReadiness');
  const [open, setOpen] = useState(false);
  const [serverText, setServerText] = useState('');
  const [sending, setSending] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const daemonDown = useDaemonDown() && !previewOnly;
  if (view === undefined) {
    return null;
  }
  const id = encodeURIComponent(session.sessionId);
  const baseLabel = view.label.replace(/ \(.*\)$/, '');

  const send = async (force: boolean): Promise<void> => {
    setSending(true);
    setDialogError('');
    onError('');
    const result = await requestJson<OwnedSwitchResponse>(`/owned/${id}/switch`, { method: 'POST', body: { target: view.target, force } });
    setSending(false);
    if (!result.ok) {
      if (!force && (result.code === 'switch-not-ready' || result.code === 'switch-draft')) {
        // The daemon found something the page did not show: its words are the reasons, and the user decides.
        setServerText(result.text);
        setOpen(true);
        return;
      }
      (open ? setDialogError : onError)(result.text);
      return;
    }
    if (!result.value.ok) {
      // violations-suppress: ts/no-err-message-direct a field of an API response body, not a caught Error
      const text = `${result.value.error.message}${result.value.error.hint === '' ? '' : `. ${result.value.error.hint}`}`;
      (open ? setDialogError : onError)(text);
      return;
    }
    setOpen(false);
    setServerText('');
    onChange({ kind: 'updated', session: result.value.session });
    onNote(movedText(result.value.session, view.target, result.value.notes));
  };

  const click = (): void => {
    if (previewOnly) {
      onNote('Preview only (A/B dock): nothing was handed over. Pick Real in "Preview hand-over" to leave the preview.');
      return;
    }
    if (view.needsConfirm) {
      setServerText('');
      setDialogError('');
      setOpen(true);
      return;
    }
    void send(false);
  };

  const close = (): void => {
    setOpen(false);
    setServerText('');
    setDialogError('');
  };

  const unknown = view.readiness === 'unknown' && serverText === '';
  const dialog = open ? (
    <ConfirmDialog
      title={unknown ? `${baseLabel} without knowing what runs?` : `${baseLabel} while something runs?`}
      confirmLabel="Hand over anyway"
      danger
      busy={sending}
      error={dialogError}
      onConfirm={() => void send(true)}
      onCancel={close}
    >
      {serverText === '' ? <ReasonList reasons={view.reasons} /> : <p>{prose(serverText)}</p>}
      <p>The session keeps its id and its conversation; only what is listed above is lost.</p>
      <p className="text-xs text-muted">agent-manager checks again when you confirm: if the session changed meanwhile, you see the new list instead.</p>
    </ConfirmDialog>
  ) : null;
  if (compact) {
    // The one-line header: a plain muted icon button. Its glyph says the readiness in a part (readinessStyle), its accessible name and its tooltip say it in words:
    // the headline, then one row per kind of thing that is interrupted with its count (the whole reasons are in the confirmation).
    const tipRows = daemonDown ? [] : moveTipRows(view.reasons);
    const title = daemonDown ? DAEMON_DOWN_TITLE : tipRows.length === 0 ? `${view.label}. ${view.title}` : `${baseLabel}: click to review what it interrupts`;
    const name = view.readiness === 'free' ? `${view.label}: nothing is running` : view.label;
    const off = disabled || sending || daemonDown;
    return (
      <>
        <span data-adopt-button="" data-readiness={view.readiness} className="inline-flex shrink-0">
          {tipRows.length === 0 ? (
            <IconButton variant="ghost" aria-label={name} tooltip={title} disabled={off} onClick={click} icon={<HandOverIcon variant={readinessStyle} state={view.readiness} />} />
          ) : (
            // The IconButton tooltip is a text: the structured rows need our own Tooltip, and an EMPTY title tells the IconButton not to add its own (the only title passed to a button, ui/noNativeTitle.test.ts). The dsl-ui IconButton has no `tooltipRows` yet.
            <Tooltip content={title} rows={tipRows} maxWidth="sm">
              <IconButton variant="ghost" aria-label={name} title="" disabled={off} onClick={click} icon={<HandOverIcon variant={readinessStyle} state={view.readiness} />} />
            </Tooltip>
          )}
        </span>
        {dialog}
      </>
    );
  }
  return (
    <>
      {/* The base button takes no data attribute and no title: the wrapper carries them (the tests and the tooltip read them there). */}
      <Tooltip content={daemonDown ? DAEMON_DOWN_TITLE : view.title}>
        <span data-adopt-button="" data-readiness={view.readiness} className="inline-flex shrink-0">
          <ButtonAction variant="secondary" size="sm" disabled={disabled || sending || daemonDown} onClick={click} icon={<HandOverIcon variant={readinessStyle} state={view.readiness} className="h-3.5 w-3.5" />} label={view.label} />
        </span>
      </Tooltip>
      {daemonDown ? (
        <p data-move-unavailable="" className="basis-full text-xs text-muted">
          {MOVE_DAEMON_DOWN}
        </p>
      ) : null}
      {dialog}
    </>
  );
}
