import { Zap } from 'lucide-react';
import { FOCUS_RING } from '../deps.js';

export function PriorityConfirm({ onConfirm, onCancel, busy }: { onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div role="alertdialog" aria-label="Confirm interrupt" className="flex flex-wrap items-center gap-2 rounded border border-warning bg-warning-bg px-3 py-2 text-sm text-warning-text">
      <Zap aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
      <p className="min-w-0 flex-1">Interrupting aborts the tool call the agent is running right now. Work in that call is lost. Send anyway?</p>
      <button type="button" disabled={busy} onClick={onCancel} className={`rounded border border-border bg-surface px-2 py-1 text-xs text-content hover:bg-muted-bg disabled:opacity-50 ${FOCUS_RING}`}>
        Cancel
      </button>
      <button type="button" disabled={busy} onClick={onConfirm} className={`rounded border border-warning bg-surface px-2 py-1 text-xs font-medium text-warning-text hover:bg-muted-bg disabled:opacity-50 ${FOCUS_RING}`}>
        Interrupt and send
      </button>
    </div>
  );
}
