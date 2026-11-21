import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { FOCUS_RING } from './IconButton.js';
import { DIALOG_FOOTER, Modal } from './Modal.js';

export interface ConfirmDialogProps {
  title: string;
  /** What happens, in words the user can check before saying yes. */
  children: ReactNode;
  confirmLabel: string;
  /** The action cannot be undone from this page: the confirm button is red. */
  danger?: boolean;
  /** The request runs: both buttons wait and the dialog cannot be dismissed. */
  busy?: boolean;
  /** The failure of the last attempt, shown in the dialog (the dialog stays open so the user can retry or cancel). */
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A yes/no dialog. The focus starts on Cancel: Enter never confirms by accident. */
export function ConfirmDialog({ title, children, confirmLabel, danger = false, busy = false, error = '', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel} dismissible={!busy} size="narrow">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 text-sm text-content">{children}</div>
        {error !== '' ? (
          <p role="alert" className="rounded border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        ) : null}
        <div className={DIALOG_FOOTER}>
          <button type="button" data-autofocus="" disabled={busy} onClick={onCancel} className={`rounded border border-border px-3 py-1.5 text-sm text-content hover:bg-muted-bg disabled:opacity-50 ${FOCUS_RING}`}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${danger ? 'border-danger bg-danger-bg text-danger-text' : 'border-primary bg-primary-light text-primary'} ${FOCUS_RING}`}
          >
            {busy ? <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm animate-spin motion-reduce:animate-none" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
