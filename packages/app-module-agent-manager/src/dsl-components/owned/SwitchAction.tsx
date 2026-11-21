import { ArrowRightLeft, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { switchViewOf } from '../logic/adoptSwitch.js';
import type { SwitchView } from '../logic/adoptSwitch.js';
import type { OwnedSessionDto, OwnedSwitchResponse } from '../shared.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import type { OwnedChange } from '../workspace/useOwnedRows.js';

export interface SwitchActionProps {
  session: AgentRow;
  disabled: boolean;
  /** The daemon's answer: the list shows the session on its new host at once. */
  onChange: (change: OwnedChange) => void;
  /** What the user must read after a successful move (where it runs now, what stays to know). */
  onNote: (text: string) => void;
  /** A refusal that is not a question for the user (an untrusted folder, a daemon that is down): shown under the buttons with its hint. */
  onError: (text: string) => void;
}

const BUTTON = `inline-flex h-am-hit items-center gap-1.5 rounded border px-3 text-sm hover:bg-muted-bg disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;
const TONE: Record<SwitchView['tone'], string> = {
  neutral: 'border-primary bg-primary-light text-primary',
  warning: 'border-warning bg-warning-bg text-warning-text',
};

function movedText(dto: OwnedSessionDto, target: SwitchView['target'], notes: readonly string[]): string {
  const where = target === 'hc' ? `in a herdr-core terminal (${dto.hcAddress ?? 'address unknown'})` : 'as a Web session';
  return [`The session now runs ${where}: same session id, same conversation.`, ...notes].join(' ');
}

/**
 * The Move button of an owned session: Web <-> herdr-core terminal, same session id. Free = neutral and moves at once; busy or unknown = amber, its label says
 * what is interrupted, and a click opens a dialog that lists the reasons (the "Move anyway" button is the only thing that sends `force`). The daemon
 * recomputes the readiness: when it finds the session not free after all, the dialog opens with ITS reasons, whatever colour the page showed.
 */
export function SwitchAction({ session, disabled, onChange, onNote, onError }: SwitchActionProps) {
  const view = switchViewOf(session);
  const [open, setOpen] = useState(false);
  const [serverText, setServerText] = useState('');
  const [sending, setSending] = useState(false);
  const [dialogError, setDialogError] = useState('');
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
  return (
    <>
      <button type="button" data-adopt-button="" data-readiness={view.readiness} disabled={disabled || sending} title={view.title} onClick={click} className={`${BUTTON} ${TONE[view.tone]}`}>
        <Icon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
        {view.label}
      </button>
      {open ? (
        <ConfirmDialog
          title={unknown ? `${baseLabel} without knowing what runs?` : `${baseLabel} while something runs?`}
          confirmLabel="Move anyway"
          danger
          busy={sending}
          error={dialogError}
          onConfirm={() => void send(true)}
          onCancel={close}
        >
          {serverText === '' ? (
            <ul className="list-disc pl-5">
              {view.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p>{serverText}</p>
          )}
          <p>The session keeps its id and its conversation. What is listed above is interrupted, left running unseen, or not restored.</p>
          <p>agent-manager checks this again when you confirm: if the session moved on meanwhile, you see the new list instead.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
