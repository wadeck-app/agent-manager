import { ButtonAction, Tooltip } from '@wadeck-app/dsl-ui';
import { ArrowRightLeft, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { MOVE_DAEMON_DOWN, moveStatusOf, switchViewOf } from '../logic/adoptSwitch.js';
import type { SwitchView } from '../logic/adoptSwitch.js';
import type { OwnedSessionDto, OwnedSwitchResponse } from '../shared.js';
import { chipClass } from '../ui/Chip.js';
import { TipIconButton } from '../ui/TipIconButton.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { useDaemonDown } from './DaemonState.js';
import { MoveBadgeView } from './MoveBadgeView.js';
import { MoveBanner } from './MoveBanner.js';
import { ReasonList } from './ReasonList.js';

import { useUiVariant } from '../ui/UiVariants.js';
import type { OwnedChange } from '../workspace/useOwnedRows.js';
import { RowButton } from '../ui/RowButton.js';

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
  /** The dev dock preview of the Move readiness: the button looks as usual but a click only says that it is a preview (nothing is sent, the daemon state does not matter). */
  previewOnly?: boolean;
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
    if (previewOnly) {
      onNote('Preview only (A/B dock): nothing was moved. Pick Real in "Preview Move readiness" to leave the preview.');
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
    // The three looks of the A/B question in the one-line header: badge (a grey icon, the badge is in the line), button (a coloured pill with words: green free, amber busy or unknown), banner (a grey icon, a row under the header: MoveBanner).
    const coloured = readinessStyle === 'button';
    const count = view.reasons.length;
    const words = view.readiness === 'free' ? 'Move: free' : view.readiness === 'busy' ? `Move: ${count} running` : 'Move: unknown';
    const title = daemonDown ? DAEMON_DOWN_TITLE : `${view.label}. ${view.title}`;
    const off = disabled || sending || daemonDown;
    return (
      <>
        <span data-adopt-button="" data-readiness={view.readiness} data-tone={coloured ? view.tone : 'neutral'} className="relative inline-flex shrink-0">
          {coloured ? (
            <Tooltip content={title}>
            <RowButton type="button" aria-label={view.label} disabled={off} onClick={click} className={`${chipClass(view.tone === 'warning' ? 'warning' : 'success')} cursor-pointer hover:brightness-95 ${FOCUS_RING}${off ? ' cursor-not-allowed opacity-50' : ''}`}>
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              {words}
            </RowButton>
            </Tooltip>
          ) : readinessStyle === 'badge' ? (
            // Look A: the icon is coloured and sits in a tinted rounded square (green free, amber busy or unknown), so the readiness shows even when the badge of the line has no room (the words are the accessible name).
            <span data-readiness-tint={view.readiness} className={`inline-flex rounded-md border ${view.readiness === 'free' ? 'border-hue-green/40 bg-hue-green-bg text-hue-green' : 'border-warning/50 bg-warning-bg text-warning-text'}`}>
              <TipIconButton variant="ghost" aria-label={view.label} tip={title} disabled={off} onClick={click} icon={<Icon aria-hidden="true" className="h-4 w-4" />} />
            </span>
          ) : (
            <TipIconButton variant="ghost" aria-label={view.label} tip={title} disabled={off} onClick={click} icon={<Icon aria-hidden="true" className="h-4 w-4" />} />
          )}
          {/* Look A: a 10 px dot on the corner of the tinted icon, cut from the header by a ring. */}
          {readinessStyle === 'badge' ? <span aria-hidden="true" data-readiness-dot={view.readiness} className={`pointer-events-none absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${view.readiness === 'free' ? 'bg-hue-green' : 'bg-warning'}`} /> : null}
        </span>
        {dialog}
      </>
    );
  }
  return (
    <>
      {/* The base button takes no data attribute and no title: the wrapper carries them (the tests and the tooltip read them there). */}
      <Tooltip content={daemonDown ? DAEMON_DOWN_TITLE : view.title}>
      <span data-adopt-button="" data-readiness={view.readiness} data-tone={tone} className="inline-flex shrink-0">
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
      </Tooltip>
      {/* The badge of the A/B question ui-switch-readiness (the default look): every state, free included, in words. */}
      {readinessStyle === 'badge' && !view.recovery && status.badge !== undefined ? <MoveBadgeView badge={status.badge} /> : null}
      {readinessStyle === 'banner' ? <MoveBanner session={session} /> : null}
      {daemonDown ? (
        <p data-move-unavailable="" className="basis-full text-xs text-muted">
          {MOVE_DAEMON_DOWN}
        </p>
      ) : null}
      {dialog}
    </>
  );
}
