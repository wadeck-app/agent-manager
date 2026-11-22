import { ButtonAction } from '@wadeck-app/dsl-ui';
import type { ReactNode } from 'react';
import { DialogActions } from './DialogActions.js';
import { Modal } from './Modal.js';

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
        <DialogActions>
          {/* The focus starts on Cancel (Modal reads data-autofocus on a wrapper). */}
          <span data-autofocus="" className="inline-flex">
            <ButtonAction variant="secondary" label="Cancel" disabled={busy} onClick={onCancel} />
          </span>
          <ButtonAction variant={danger ? 'danger' : 'primary'} label={confirmLabel} loading={busy} onClick={onConfirm} />
        </DialogActions>
      </div>
    </Modal>
  );
}
