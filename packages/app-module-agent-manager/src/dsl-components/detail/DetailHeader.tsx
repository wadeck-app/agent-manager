import { ArrowLeft, ChevronsDownUp, ChevronsUpDown, GitFork, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentRow } from '../data/types.js';
import { ForkDialog } from '../launch/ForkDialog.js';
import { FORK_MEANING, forkBlockedReason } from '../logic/forkForm.js';
import { STATE_MEANING } from '../logic/states.js';
import { threadChipText } from '../logic/threadForm.js';
import type { OwnedSessionDto } from '../shared.js';
import { describeTimeInState, timeInState } from '../logic/time.js';
import { IconButton } from '@wadeck-app/dsl-ui';
import { useUiVariant } from '../ui/UiVariants.js';
import { useMediaQuery } from '../ui/hooks.js';
import { STATE_LOOK } from '../ui/stateLook.js';
import { StatusIcon } from '../ui/StatusIcon.js';
import { Tooltip } from '../ui/Tooltip.js';
import { GuardrailBlocks } from '../guardrails/GuardrailBlocks.js';
import { MoveStatusLine } from '../owned/MoveStatus.js';
import { OwnedBar } from '../owned/OwnedBar.js';
import type { OwnedChange } from '../workspace/useOwnedRows.js';
import { HeaderActions } from './HeaderActions.js';
import { HeaderLine } from './HeaderLine.js';
import { StatusInfo } from './status/StatusInfo.js';
import { useSessionStatus } from './status/useSessionStatus.js';

const DETAILS_KEY = 'agent-manager.header-details.v1';

/** Whether the status chips of the header are open: the user's choice (kept), else open except on a short or narrow window, where the log needs the room more. */
function useDetailsOpen(): [boolean, (open: boolean) => void] {
  // Short or narrow (a phone): the chips wrap one per line there and would take half of the screen.
  const lowScreen = useMediaQuery('(max-height: 799px)');
  const phone = useMediaQuery('(max-width: 599px)');
  const short = lowScreen || phone;
  const [chosen, setChosen] = useState<boolean | undefined>(() => {
    try {
      const saved = window.localStorage.getItem(DETAILS_KEY);
      return saved === 'open' ? true : saved === 'closed' ? false : undefined;
    } catch {
      return undefined;
    }
  });
  const choose = (open: boolean): void => {
    setChosen(open);
    try {
      window.localStorage.setItem(DETAILS_KEY, open ? 'open' : 'closed');
    } catch {
      // Not kept: the choice resets on reload. Nothing the user could fix.
    }
  };
  return [chosen ?? !short, choose];
}

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
  /** The daemon started a fork of this session: the page lists and selects it. */
  onForked: (session: OwnedSessionDto) => void;
  /** This session is a fork: the source (its name when it is in the list, else undefined) and a way to open it. */
  forkedFrom?: { id: string; name: string | undefined };
  onOpenSource: (id: string) => void;
  /** This session is a thread: opens the source and brings the message it stops at into view. Absent: no link. */
  onLocateAnchor?: (sessionId: string, messageId: string) => void;
}

/** Name, folder, state, harness, pid and the two actions of the selected session. The back button only exists on a narrow screen (stacked panes). */
export function DetailHeader({ session, now, busy, onBack, onTogglePin, onMarkSeen, onOwnedChange, onForgotten, onForked, forkedFrom, onOpenSource, onLocateAnchor }: DetailHeaderProps) {
  const look = STATE_LOOK[session.state];
  const since = timeInState(session.statusUpdatedAt, now);
  const canMarkSeen = session.state === 'done';
  // The status line data: the live one of the log poll, else the one of the session row (one source at a time).
  const status = useSessionStatus(session);
  // The id of the session the dialog was opened for: selecting another session closes it (a dialog never forks a session the user did not click on).
  const [forkFor, setForkFor] = useState<string | undefined>(undefined);
  const forkId = session.sessionId.toLowerCase();
  // Leaving the session forgets the dialog (coming back does not reopen it).
  useEffect(() => setForkFor(undefined), [forkId]);
  const forkBlocked = forkBlockedReason(session);
  const [detailsOpen, setDetailsOpen] = useDetailsOpen();
  // The element of the header line the controls of an owned session are drawn into (the one-line looks).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // The A/B question ui-header-actions: the one-line header (line, line-menu) or the previous three rows (detailed).
  const actionsLook = useUiVariant('headerActions');
  const actions = <HeaderActions busy={busy} onFork={() => setForkFor(forkId)} forkBlocked={forkBlocked} forkMeaning={FORK_MEANING} pinned={session.pinned} onTogglePin={() => onTogglePin(!session.pinned)} canMarkSeen={canMarkSeen} onMarkSeen={onMarkSeen} />;
  // A permission request of a Web session is already shown by its card under the log: the reason would say the same a third time.
  const reasonLine =
    session.state === 'needs-you' && session.reason !== '' && !(session.host === 'stream-json' && session.pendingPermissions > 0) ? <p className="mt-1 text-sm text-hue-red">{session.reason}</p> : null;
  const originLine =
    session.threadOf !== undefined ? (
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted">
            <span data-thread-of="" className="min-w-0 truncate">
              {threadChipText(forkedFrom?.name, session.threadOf.quote, session.threadOf.messageId)}
            </span>
            {onLocateAnchor !== undefined ? (
              <button type="button" aria-label="Go to the message in the original" onClick={() => onLocateAnchor(session.threadOf!.sessionId, session.threadOf!.messageId)} className="shrink-0 text-primary underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                Go to the message
              </button>
            ) : null}
          </p>
        ) : forkedFrom === undefined ? null : (
          <p data-forked-from="" className="mt-0.5 truncate text-xs text-muted">
            <GitFork aria-hidden="true" className="mr-1 inline h-am-icon-sm w-am-icon-sm align-text-bottom" />
            forked from{' '}
            {forkedFrom.name === undefined ? (
              <span title={`${forkedFrom.id}: not in the list (ended or forgotten)`}>{`${forkedFrom.id.slice(0, 8)} (not in the list)`}</span>
            ) : (
              <button type="button" onClick={() => onOpenSource(forkedFrom.id)} className="text-primary underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {forkedFrom.name}
              </button>
            )}
          </p>
        );
  // The key differs from the one of OwnedBar below (the lower-cased session id): two siblings with one key make React duplicate one of them in the DOM.
  const forkDialog = forkFor === forkId ? <ForkDialog key={`fork-${forkId}`}session={session} onClose={() => setForkFor(undefined)} onForked={onForked} /> : null;
  if (actionsLook !== 'detailed') {
    // The one-line header: everything on one line, the actions at its right; only what has something to say gets a line under it (a fork or thread origin, a warning, a reason).
    return (
      <header data-header-layout="line" className="flex max-h-[50vh] shrink-0 flex-col gap-1 overflow-y-auto border-b border-border px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="lg:hidden">
            <IconButton icon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />} aria-label="Back to the list" onClick={onBack} />
          </span>
          <HeaderLine session={session} status={status} now={now} />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {/* The controls of an owned session are drawn here by its bar (a portal), as icons. */}
            <span ref={setSlot} className="contents" />
            {actions}
          </div>
        </div>
        {originLine}
        {status.statusNote === undefined || status.statusNote === '' ? null : (
          <p role="status" className="inline-flex items-center gap-1 text-xs text-warning-text">
            <TriangleAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
            {status.statusNote}
          </p>
        )}
        <GuardrailBlocks blocks={session.guardrailBlocks} />
        <OwnedBar key={session.sessionId.toLowerCase()} session={session} onChange={onOwnedChange} onForgotten={onForgotten} inline={{ slot }} />
        {reasonLine}
        {forkDialog}
      </header>
    );
  }
  return (
    <header className="flex max-h-[50vh] shrink-0 items-start gap-2 overflow-y-auto border-b border-border px-4 py-3">
      <span className="lg:hidden">
        <IconButton icon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />} aria-label="Back to the list" onClick={onBack} />
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
        {originLine}
        <StatusInfo session={session} status={status} collapsed={!detailsOpen} />
        <GuardrailBlocks blocks={session.guardrailBlocks} />
        <MoveStatusLine session={session} />
        <OwnedBar key={session.sessionId.toLowerCase()} session={session} onChange={onOwnedChange} onForgotten={onForgotten} />
        {reasonLine}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          variant={detailsOpen ? 'neutral' : 'ghost'}
          icon={detailsOpen ? <ChevronsDownUp aria-hidden="true" className="h-4 w-4" /> : <ChevronsUpDown aria-hidden="true" className="h-4 w-4" />}
          aria-label={detailsOpen ? 'Hide details' : 'Show details'}
          aria-pressed={detailsOpen}
          onClick={() => setDetailsOpen(!detailsOpen)}
        />
        {actions}
      </div>
      {forkDialog}
    </header>
  );
}
