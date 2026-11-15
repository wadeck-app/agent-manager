import { useUrlParam } from '@wadeck-app/dsl-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { requestJson } from '../data/http.js';
import { AgentDetail } from '../detail/AgentDetail.js';
import { DetailHeader } from '../detail/DetailHeader.js';
import { CardsList } from '../lists/CardsList.js';
import type { ListProps } from '../lists/common.js';
import { GroupsList } from '../lists/GroupsList.js';
import { InboxList } from '../lists/InboxList.js';
import { PaletteList } from '../lists/PaletteList.js';
import { TreeList } from '../lists/TreeList.js';
import { agentId } from '../logic/states.js';
import type { ListKind, LogStyle, SessionRowDto } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import { useFillViewport, useNow } from '../ui/hooks.js';
import { ListSkeleton } from '../ui/ListSkeleton.js';
import { SplitPane } from '../ui/SplitPane.js';
import { Toolbar } from './Toolbar.js';
import { useInFlight } from './useInFlight.js';
import { useOptimisticRows } from './useOptimisticRows.js';
import { usePageShortcuts } from './usePageShortcuts.js';

const LISTS: Record<ListKind, (props: ListProps) => ReactNode> = {
  groups: GroupsList,
  inbox: InboxList,
  tree: TreeList,
  'tabs-cards': CardsList,
  palette: PaletteList,
};

/** How long a Done session stays open before it counts as seen (decision 45: opening it marks it seen). */
export const SEEN_AFTER_MS = 1500;

export interface WorkspaceProps {
  list: ListKind;
  style: string;
  /** The rows of the page poll, undefined until the first answer. The page owns the one request: the workspace never fetches the list itself. */
  sessions: readonly SessionRowDto[] | undefined;
  userStateError: string;
  hiddenDead: number;
  logStyle?: LogStyle;
}

export function Workspace({ list, style, sessions, userStateError, hiddenDead, logStyle }: WorkspaceProps) {
  const root = useRef<HTMLDivElement>(null);
  useFillViewport(root, 360);
  const now = useNow();
  const optimistic = useOptimisticRows(sessions ?? []);
  const rows = optimistic.rows;
  const loading = sessions === undefined;
  const [showParam, setShowParam] = useUrlParam('show');
  const show = showParam === 'all' ? 'all' : 'alive';
  const [sessionParam, setSessionParam] = useUrlParam('session');
  const selectedId = sessionParam === null || sessionParam === '' ? undefined : sessionParam.toLowerCase();
  const selected = useMemo(() => rows.find((session) => agentId(session) === selectedId), [rows, selectedId]);
  const [actionError, setActionError] = useState('');
  const { busy, track } = useInFlight();
  const [helpOpen, setHelpOpen] = useState(false);

  const select = useCallback((id: string) => setSessionParam(id), [setSessionParam]);

  const act = useCallback(async (path: string, body: unknown, failure: string, onFail: () => void): Promise<void> => {
    const result = await track(requestJson(path, { method: 'POST', body }));
    if (result.ok) {
      setActionError('');
    } else {
      onFail();
      setActionError(`${failure}: ${result.text}`);
    }
  }, [track]);

  const pin = useCallback(
    (session: SessionRowDto, pinned: boolean) => {
      optimistic.patch(session.sessionId, { kind: 'pin', pinned, pinOrder: optimistic.nextPinOrder() });
      void act(`/sessions/${session.sessionId}/pin`, { pinned }, pinned ? 'Could not pin the session' : 'Could not unpin the session', () => optimistic.revert(session.sessionId));
    },
    [act, optimistic],
  );
  const markSeen = useCallback(
    (session: SessionRowDto) => {
      optimistic.patch(session.sessionId, { kind: 'seen' });
      void act(`/sessions/${session.sessionId}/seen`, undefined, 'Could not mark the session seen', () => optimistic.revert(session.sessionId));
    },
    [act, optimistic],
  );

  // Opening a Done session marks it seen once it has stayed open a moment (not on every key press while moving through the list).
  const seenKey = selected?.state === 'done' ? `${selected.sessionId}:${selected.statusUpdatedAt ?? ''}` : undefined;
  useEffect(() => {
    if (seenKey === undefined || selected === undefined) {
      return;
    }
    const timer = setTimeout(() => markSeen(selected), SEEN_AFTER_MS);
    return () => clearTimeout(timer);
    // `selected` and `markSeen` change on every poll; the key alone says "the same Done session is still open".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenKey]);

  usePageShortcuts({
    selectedId,
    select,
    togglePin: () => {
      if (selected !== undefined) {
        pin(selected, !selected.pinned);
      }
    },
    close: () => setSessionParam(''),
    toggleHelp: () => setHelpOpen((open) => !open),
  });

  const List = LISTS[list];
  const fixedWidth = list === 'tabs-cards' && style === 'rail' ? 56 : undefined;
  const listColumn = loading ? <ListSkeleton /> : <List sessions={rows} selectedId={selectedId} onSelect={select} now={now} style={style} />;

  const notices: ReactNode[] = [];
  if (userStateError !== '') {
    notices.push(
      <Banner key="user" tone="warning">
        {userStateError}
      </Banner>,
    );
  }
  if (actionError !== '') {
    notices.push(
      <Banner
        key="action"
        tone="error"
        action={
          <button type="button" onClick={() => setActionError('')} className={`shrink-0 rounded border border-danger px-2 py-0.5 text-xs ${FOCUS_RING}`}>
            Dismiss
          </button>
        }
      >
        {actionError}
      </Banner>,
    );
  }

  let detail: ReactNode;
  if (selected !== undefined) {
    detail = (
      <>
        <DetailHeader session={selected} now={now} busy={busy} onBack={() => setSessionParam('')} onTogglePin={(pinned) => pin(selected, pinned)} onMarkSeen={() => markSeen(selected)} />
        <AgentDetail session={selected} logStyle={logStyle} />
      </>
    );
  } else if (selectedId !== undefined && !loading) {
    detail = (
      <div className="flex flex-1 flex-col items-start gap-3 p-4">
        <Banner tone="warning">The session {selectedId} is not in the list: it may have ended, or the filter above hides the ended sessions.</Banner>
        <button type="button" onClick={() => setSessionParam('')} className={`rounded border border-border px-3 py-1.5 text-sm text-content hover:bg-muted-bg ${FOCUS_RING}`}>
          Close this session
        </button>
      </div>
    );
  } else {
    detail = (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted">
        <p className="font-medium text-content">Select an agent</p>
        <p>Its log and a box to reply to it open here. J and K move in the list, Enter goes to the reply box, ? lists the shortcuts.</p>
      </div>
    );
  }

  return (
    <div ref={root} className="flex min-h-0 flex-col gap-2">
      <Toolbar count={rows.length} hiddenDead={hiddenDead} show={show} onShow={(value) => setShowParam(value === 'all' ? 'all' : '')} helpOpen={helpOpen} onHelpOpenChange={setHelpOpen} />
      {notices.length > 0 ? <div className="flex flex-col gap-1.5">{notices}</div> : null}
      <div className="min-h-0 flex-1">
        <SplitPane list={listColumn} detail={detail} detailOpen={selectedId !== undefined} fixedWidth={fixedWidth} />
      </div>
    </div>
  );
}
