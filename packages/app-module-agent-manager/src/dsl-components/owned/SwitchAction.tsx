import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { ArrowRightLeft, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { MOVE_DAEMON_DOWN, moveStatusOf, switchViewOf } from '../logic/adoptSwitch.js';
import type { SwitchView } from '../logic/adoptSwitch.js';
import type { OwnedSessionDto, OwnedSwitchResponse } from '../shared.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { useDaemonDown } from './DaemonState.js';
import { MoveBadgeView } from './MoveBadgeView.js';
import { ReasonList } from './ReasonList.js';

import { useUiVariant } from '../ui/UiVariants.js';
import type { OwnedChange } from '../workspace/useOwnedRows.js';

const DAEMON_DOWN_TITLE = 'The agent-manager daemon is not running, so the session cannot move. Start it in a terminal: agent-manager start --detach';

export interface SwitchActionProps {
  session: AgentRow;
  disabled: boolean;
  /** The daemon's answer: the list shows the session on its new host at once. */
  onChange: (change: OwnedChange) => void;
  /** What the user must read after a successful move (where it runs now, what stays to know). */
  onNote: (text: string) => void;
  /** A refusal that is not a question for the user (an untrusted folder, a daemon that is down): shown under the buttons with its hint. */
  onError: (text: string) => void;
  /** The one-line header: an icon button coloured by the readiness (its words are the accessible name and the tooltip); the badge and the daemon line are the header's. */
  compact?: boolean;
}


function movedText(dto: OwnedSessionDto, target: SwitchView['target'], notes: readonly string[]): string {
  const where = target === 'hc' ? `as a Terminal session (herdr-core terminal ${dto.hcAddress ?? 'address unknown'})` : 'as a Web session';
  return [`The session now runs ${where}: same session id, same conversation.`, ...notes].join(' ');
}

/**
 * The Move button of an owned session: Web <-> herdr-core terminal, same session id. Free = neutral and moves at once; busy or unknown = amber, its label says
 * what is interrupted, and a click opens a dialog that lists the reasons (the "Move anyway" button is the only thing that sends `force`). The daemon
 * recomputes the readiness: when it finds the session not free after all, the dialog opens with ITS reasons, whatever colour the page showed.
 */
export function SwitchAction({ session, disabled, onChange, onNote, onError, compact = false }: SwitchActionProps) {
  const view = switchViewOf(session);
  const readinessStyle = useUiVariant('switchReadiness');
  const [open, setOpen] = useState(false);
  const [serverText, setServerText] = useState('');
  const [sending, setSending] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const daemonDown = useDaemonDown();
  if (view === undefined) {
    return null;
  }
  const id = encodeURIComponent(session.sessionId);
  const Icon = view.tone === 'warning' ? TriangleAlert : ArrowRightLeft;
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
  const warn = view.tone === 'warning' && view.recovery !== true;
  // The three looks of the A/B question ui-switch-readiness. The words of the full label stay in the accessible name in every look (the colour is never the only signal).
  const detail = view.label.slice(baseLabel.length).trim();
  const status = moveStatusOf(session, daemonDown);
  const separate = warn && readinessStyle !== 'button';
  const tone: SwitchView['tone'] = separate ? 'neutral' : view.tone;
  const dialog = open ? (
    <ConfirmDialog
      title={unknown ? `${baseLabel} without knowing what runs?` : `${baseLabel} while something runs?`}
      confirmLabel="Move anyway"
      danger
      busy={sending}
      error={dialogError}
      onConfirm={() => void send(true)}
      onCancel={close}
    >
      {serverText === '' ? <ReasonList reasons={view.reasons} /> : <p>{serverText}</p>}
      <p>The session keeps its id and its conversation; only what is listed above is lost.</p>
      <p className="text-xs text-muted">agent-manager checks again when you confirm: if the session changed meanwhile, you see the new list instead.</p>
    </ConfirmDialog>
  ) : null;
  if (compact) {
    return (
      <>
        <span data-adopt-button="" data-readiness={view.readiness} data-tone={view.tone} className="inline-flex shrink-0">
          <IconButton variant={view.tone === 'warning' ? 'danger-outline' : 'ghost'} aria-label={view.label} title={daemonDown ? DAEMON_DOWN_TITLE : `${view.label}. ${view.title}`} disabled={disabled || sending || daemonDown} onClick={click} icon={<Icon aria-hidden="true" className="h-4 w-4" />} />
        </span>
        {dialog}
      </>
    );
  }
  return (
    <>
      {/* The base button takes no data attribute and no title: the wrapper carries them (the tests and the tooltip read them there). */}
      <span data-adopt-button="" data-readiness={view.readiness} data-tone={tone} title={daemonDown ? DAEMON_DOWN_TITLE : view.title} className="inline-flex shrink-0">
        <ButtonAction
          variant={tone === 'warning' ? 'danger-outline' : 'secondary'}
          size="sm"
          disabled={disabled || sending || daemonDown}
          onClick={click}
          icon={<Icon aria-hidden="true" className="h-3.5 w-3.5" />}
          label={separate ? baseLabel : view.label}
        />
        {separate ? <span className="sr-only"> {detail}</span> : null}
      </span>
      {/* The badge of the A/B question ui-switch-readiness (the default look): every state, free included, in words. */}
      {readinessStyle === 'badge' && !view.recovery && status.badge !== undefined ? <MoveBadgeView badge={status.badge} /> : null}
      {separate && readinessStyle === 'banner' ? (
        <p data-adopt-banner="" aria-hidden="true" className="flex basis-full items-start gap-1.5 rounded border border-warning bg-warning-bg px-2 py-1 text-xs text-warning-text">
          <TriangleAlert className="mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0" />
          <span>{view.readiness === 'busy' ? `Moving interrupts ${view.reasons.length} running item${view.reasons.length === 1 ? '' : 's'}: ${view.reasons[0] ?? ''}` : `agent-manager cannot tell what runs: ${view.reasons[0] ?? ''}`}</span>
        </p>
      ) : null}
      {daemonDown ? (
        <p data-move-unavailable="" className="basis-full text-xs text-muted">
          {MOVE_DAEMON_DOWN}
        </p>
      ) : null}
      {dialog}
    </>
  );
}
