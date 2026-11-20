import { ArrowLeft, CheckCheck, Pin, PinOff } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { STATE_MEANING } from '../logic/states.js';
import { describeTimeInState, timeInState } from '../logic/time.js';
import { IconButton } from '../ui/IconButton.js';
import { STATE_LOOK } from '../ui/stateLook.js';
import { StatusIcon } from '../ui/StatusIcon.js';
import { Tooltip } from '../ui/Tooltip.js';
import { OwnedBar } from '../owned/OwnedBar.js';
import type { OwnedChange } from '../workspace/useOwnedRows.js';
import { StatusInfo } from './status/StatusInfo.js';
import { useSessionStatus } from './status/useSessionStatus.js';

export interface DetailHeaderProps {
  session: AgentRow;
  now: number;
  /** An action of this header is running: its buttons wait. */
  busy: boolean;
  onBack: () => void;
  onTogglePin: (pinned: boolean) => void;
  onMarkSeen: () => void;
  /** The daemon confirmed a Stop, Resume or Forget of an owned session. */
  onOwnedChange: (change: OwnedChange) => void;
  /** The owned session was forgotten: leave its detail. */
  onForgotten: () => void;
}

/** Name, folder, state, harness, pid and the two actions of the selected session. The back button only exists on a narrow screen (stacked panes). */
export function DetailHeader({ session, now, busy, onBack, onTogglePin, onMarkSeen, onOwnedChange, onForgotten }: DetailHeaderProps) {
  const look = STATE_LOOK[session.state];
  const since = timeInState(session.statusUpdatedAt, now);
  const canMarkSeen = session.state === 'done';
  // The status line data: the live one of the log poll, else the one of the session row (one source at a time).
  const status = useSessionStatus(session);
  return (
    <header className="flex items-start gap-2 border-b border-border px-4 py-3">
      <span className="lg:hidden">
        <IconButton icon={ArrowLeft} label="Back to the list" onClick={onBack} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="min-w-0 truncate text-base font-semibold text-content" title={session.displayName}>
            {session.displayName}
          </h2>
          <Tooltip content={STATE_MEANING[session.state]}>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${look.bg} ${look.text}`}>
              <StatusIcon state={session.state} sizeClass="h-am-icon-sm w-am-icon-sm" labelled={false} />
              {look.label}
            </span>
          </Tooltip>
          {since !== '' ? (
            <Tooltip content={describeTimeInState(session.statusUpdatedAt, now)}>
              <span className="text-xs tabular-nums text-muted">{since}</span>
            </Tooltip>
          ) : null}
        </div>
        <StatusInfo session={session} status={status} />
        <OwnedBar key={session.sessionId.toLowerCase()} session={session} onChange={onOwnedChange} onForgotten={onForgotten} />
        {session.state === 'needs-you' && session.reason !== '' ? <p className="mt-1 text-sm text-hue-red">{session.reason}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton icon={session.pinned ? PinOff : Pin} label={session.pinned ? 'Unpin' : 'Pin'} disabled={busy} onClick={() => onTogglePin(!session.pinned)} />
        <IconButton icon={CheckCheck} label="Mark as seen" disabled={busy || !canMarkSeen} disabledReason={canMarkSeen ? undefined : 'only a Done session has something to mark'} onClick={onMarkSeen} />
      </div>
    </header>
  );
}
