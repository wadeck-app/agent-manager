import { ArrowLeft, GitFork, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentRow } from '../data/types.js';
import { ForkDialog } from '../launch/ForkDialog.js';
import { FORK_MEANING, forkBlockedReason } from '../logic/forkForm.js';
import { applyReadinessPreview } from '../logic/readinessPreview.js';
import { threadChipText } from '../logic/threadForm.js';
import type { OwnedSessionDto } from '../shared.js';
import { IconButton, Tooltip } from '@wadeck-app/dsl-ui';
import { BlockedChip } from './BlockedChip.js';
import { LogFilterMenu } from './log/LogFilterMenu.js';
import { OwnedBar } from '../owned/OwnedBar.js';
import { ReadinessPreviewControls } from '../owned/ReadinessPreviewControls.js';
import { useUiVariant } from '../ui/UiVariants.js';
import type { OwnedChange } from '../workspace/useOwnedRows.js';
import { HeaderActions } from './HeaderActions.js';
import { HeaderLine } from './HeaderLine.js';
import { useSessionStatus } from './status/useSessionStatus.js';
import { RowButton } from '../ui/RowButton.js';

const LOCATE_LINK = 'shrink-0 text-primary underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const SOURCE_LINK = 'text-primary underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const HEADER_BOX = 'flex max-h-[50vh] shrink-0 flex-col gap-1 overflow-x-hidden overflow-y-auto border-b border-border px-4 py-2';

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
  const canMarkSeen = session.state === 'done';
  // The status line data: the live one of the log poll, else the one of the session row (one source at a time).
  const status = useSessionStatus(session);
  // The id of the session the dialog was opened for: selecting another session closes it (a dialog never forks a session the user did not click on).
  const [forkFor, setForkFor] = useState<string | undefined>(undefined);
  const forkId = session.sessionId.toLowerCase();
  // Leaving the session forgets the dialog (coming back does not reopen it).
  useEffect(() => setForkFor(undefined), [forkId]);
  const forkBlocked = forkBlockedReason(session);
  // The element of the header line the controls of an owned session are drawn into (the one-line looks).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // The test helper of the A/B dock (never active without the dock): what the header says about handing over is forced, on any agent.
  const previewState = useUiVariant('readinessPreview');
  const preview = applyReadinessPreview(session, previewState);
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
              <RowButton type="button" aria-label="Go to the message in the original" onClick={() => onLocateAnchor(session.threadOf!.sessionId, session.threadOf!.messageId)} className={LOCATE_LINK}>
                Go to the message
              </RowButton>
            ) : null}
          </p>
        ) : forkedFrom === undefined ? null : (
          <p data-forked-from="" className="mt-0.5 truncate text-xs text-muted">
            <GitFork aria-hidden="true" className="mr-1 inline h-am-icon-sm w-am-icon-sm align-text-bottom" />
            forked from{' '}
            {forkedFrom.name === undefined ? (
              <Tooltip content={`${forkedFrom.id}: not in the list (ended or forgotten)`}>
                <span>{`${forkedFrom.id.slice(0, 8)} (not in the list)`}</span>
              </Tooltip>
            ) : (
              <RowButton type="button" onClick={() => onOpenSource(forkedFrom.id)} className={SOURCE_LINK}>
                {forkedFrom.name}
              </RowButton>
            )}
          </p>
        );
  // The key differs from the one of OwnedBar below (the lower-cased session id): two siblings with one key make React duplicate one of them in the DOM.
  const forkDialog = forkFor === forkId ? <ForkDialog key={`fork-${forkId}`}session={session} onClose={() => setForkFor(undefined)} onForked={onForked} /> : null;
  // The one-line header: everything on one line, the actions at its right; only what has something to say gets a line under it (a fork or thread origin, a warning, a reason).
  return (
    <header data-header-layout="line" className={HEADER_BOX}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="lg:hidden">
          <IconButton icon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />} aria-label="Back to the list" onClick={onBack} />
        </span>
        <HeaderLine session={preview.session} status={status} now={now} />
        {/* The action icons wrap onto a second row on a narrow screen instead of leaving the viewport. */}
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
          {/* The controls of an owned session are drawn here by its bar (a portal), as icons. */}
          <span ref={setSlot} className="contents" />
          <BlockedChip sessionId={session.sessionId} blocks={session.guardrailBlocks} />
          {actions}
          <LogFilterMenu sessionId={session.sessionId} />
        </div>
      </div>
      {originLine}
      {status.statusNote === undefined || status.statusNote === '' ? null : (
        <p role="status" className="inline-flex items-center gap-1 text-xs text-warning-text">
          <TriangleAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
          {status.statusNote}
        </p>
      )}
      <OwnedBar key={session.sessionId.toLowerCase()} session={preview.synthetic ? session : preview.session} onChange={onOwnedChange} onForgotten={onForgotten} inline={{ slot }} />
      {previewState === 'real' ? null : <ReadinessPreviewControls preview={preview} state={previewState} slot={slot} />}
      {reasonLine}
      {forkDialog}
    </header>
  );
}
