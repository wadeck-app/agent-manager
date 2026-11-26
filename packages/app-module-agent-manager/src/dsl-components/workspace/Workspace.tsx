import { ButtonAction, Skeleton, useUrlParam } from '@wadeck-app/dsl-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { requestJson } from '../data/http.js';
import { AgentDetail } from '../detail/AgentDetail.js';
import { DetailHeader } from '../detail/DetailHeader.js';
import { NewSessionDialog } from '../launch/NewSessionDialog.js';
import type { ListProps } from '../lists/common.js';
import { EmptyNote } from '../lists/EmptyNote.js';
import { CustomList } from '../lists/CustomList.js';
import { GroupsList } from '../lists/GroupsList.js';
import { InboxList } from '../lists/InboxList.js';
import { TreeList } from '../lists/TreeList.js';
import { filterSessions, parseQuery } from '../logic/fuzzy.js';
import { readSavedMode, resolveMode, saveMode } from '../logic/mode.js';
import { navTarget } from '../logic/nav.js';
import { orderedSessionIds } from '../logic/order.js';
import { agentId } from '../logic/states.js';
import { readViewOptions, saveViewOptions, type ViewOptions } from '../logic/viewOptions.js';
import { MODE_LABEL, type ApiError, type CustomGroupDto, type ModeId, type OwnedSessionDto, type SessionRowDto } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { NoticesButton } from '../ui/Notices.js';
import { actionSummary, workspaceNotices, type NoticeItem } from '../logic/notices.js';
import { focusComposer, useNow } from '../ui/hooks.js';
import { useFillContentArea } from '../ui/useFillContentArea.js';
import { SplitPane } from '../ui/SplitPane.js';
import { SelectionProvider } from '../lists/selection.js';
import { SelectedBar } from '../batch/SelectedBar.js';
import { SelectionKeys } from '../batch/SelectionKeys.js';
import { ListFooter } from './ListFooter.js';
import { Toolbar } from './Toolbar.js';
import { useInFlight } from './useInFlight.js';
import { DaemonStateProvider } from '../owned/DaemonState.js';
import { LiveThreadsProvider } from '../owned/LiveThreads.js';
import { useCustomGroups, type SendGroupRequest } from './useCustomGroups.js';
import { useOptimisticRows } from './useOptimisticRows.js';
import { useOwnedRows } from './useOwnedRows.js';
import { usePageShortcuts } from './usePageShortcuts.js';

const LISTS: Record<ModeId, (props: ListProps) => ReactNode> = {
  tree: TreeList,
  groups: GroupsList,
  inbox: InboxList,
  custom: CustomList,
};

/** How long a Done session stays open before it counts as seen (decision 45: opening it marks it seen). */
export const SEEN_AFTER_MS = 1500;

export interface WorkspaceProps {
  /** The rows of the page poll, undefined until the first answer. The page owns the one request: the workspace never fetches the list itself. */
  sessions: readonly SessionRowDto[] | undefined;
  userStateError: string;
  /** The custom groups of the page answer (`customGroups`), in display order; the rows say who is in which. Absent: none. */
  customGroups?: readonly CustomGroupDto[];
  hiddenDead: number;
  /** `ownedError` of the page source: why the daemon could not be asked, null when it answered. */
  ownedError: ApiError | null;
  ownedErrorText: string;
  /** The registry files that could not be read (empty when none) and the unreadable guardrails counters: warnings above the list. */
  unreadableText?: string;
  guardrailsErrorText?: string;
  /** Owned sessions that lost their actions because the daemon is down (with the fix), and the unusable owned-sessions.json: persistent warnings. */
  ownedDownText?: string;
  ownedStateErrorText?: string;
}

const NO_GROUPS: readonly CustomGroupDto[] = [];

export function Workspace({ sessions, userStateError, customGroups = NO_GROUPS, hiddenDead, ownedError, ownedErrorText, unreadableText = '', guardrailsErrorText = '', ownedDownText = '', ownedStateErrorText = '' }:WorkspaceProps) {
  const root = useRef<HTMLDivElement>(null);
  useFillContentArea(root, 360);
  const now = useNow();
  const optimistic = useOptimisticRows(sessions ?? []);
  // The user's own launch, stop, resume and forget show at once, before the next poll.
  const ownedRows = useOwnedRows(optimistic.rows);
  const { busy, track } = useInFlight();
  const [actionError, setActionError] = useState('');
  // The custom groups: the user's own move, rename or reorder shows at once; a refusal is said in the banner and the list goes back to what the server has.
  const sendGroupRequest = useCallback<SendGroupRequest>(
    async (path, body, failure) => {
      const result = await track(requestJson<unknown>(path, { method: 'POST', body }));
      if (result.ok) {
        // The banner is NOT cleared here: two drops in a row would hide the refusal of the first behind the success of the second. The user dismisses it.
        return { ok: true, value: result.value };
      }
      setActionError(`${failure}: ${result.text}`);
      return { ok: false };
    },
    [track],
  );
  const grouped = useCustomGroups(ownedRows.rows, customGroups, sendGroupRequest);
  const rows = grouped.rows;
  // The selection handler is defined before the marks request exists: it reads them through refs.
  // Every session the page has: a selected id that is not in it any more is dropped.
  const existingIds = useMemo(() => new Set(rows.map(agentId)), [rows]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const setMarksRef = useRef<(sessionId: string, marks: { flag?: boolean; unread?: boolean }) => void>(() => undefined);
  const loading = sessions === undefined;
  const [showParam, setShowParam] = useUrlParam('show');
  const show = showParam === 'all' ? 'all' : 'alive';
  const [sessionParam, setSessionParam] = useUrlParam('session');
  const selectedId = sessionParam === null || sessionParam === '' ? undefined : sessionParam.toLowerCase();
  const selected = useMemo(() => rows.find((session) => agentId(session) === selectedId), [rows, selectedId]);
  // The name of the source of a fork, from the rows of the list (undefined when the source is not listed any more).
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.sessionId.toLowerCase(), row])), [rows]);
  // The live threads of each source session (the dialog of a thread shows the cap before the daemon refuses).
  const liveThreads = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.threadOf !== undefined && row.alive) {
        const source = row.threadOf.sessionId.toLowerCase();
        counts.set(source, (counts.get(source) ?? 0) + 1);
      }
    }
    return (sessionId: string): number => counts.get(sessionId.toLowerCase()) ?? 0;
  }, [rows]);
  // The listing mode: the URL (?mode=) wins, then the saved choice, then Tree; a mode the URL names that does not exist is said, not silently replaced.
  const [modeParam, setModeParam] = useUrlParam('mode');
  const [savedMode, setSavedMode] = useState(readSavedMode);
  const resolvedMode = resolveMode(modeParam, savedMode);
  const mode = resolvedMode.mode;
  // The URL wins when it names a mode (resolveMode), so changing the mode writes BOTH the URL and the saved choice: the one the user just made is the one that shows now and that a bare address opens next time.
  const changeMode = useCallback(
    (next: ModeId) => {
      saveMode(next);
      setSavedMode(next);
      setModeParam(next);
    },
    [setModeParam],
  );
  const [options, setOptions] = useState<ViewOptions>(readViewOptions);
  // A storage that refuses is said on the page (the choice still applies until a reload), never swallowed.
  const [optionsSaveError, setOptionsSaveError] = useState('');
  const changeOptions = useCallback((next: ViewOptions) => {
    setOptionsSaveError(saveViewOptions(next) ?? '');
    setOptions(next);
  }, []);
  // The search is the same in every mode: it filters the rows before the mode draws them.
  const [searchText, setSearchText] = useState('');
  const query = useMemo(() => parseQuery(searchText), [searchText]);
  const searching = searchText.trim() !== '';
  const shownRows = useMemo(() => (searching ? filterSessions(rows, query) : rows), [searching, rows, query]);
  // The Inbox tab (?tab=) decides which rows the Inbox lists, so it decides which rows the search box walks through there.
  const [tabParam] = useUrlParam('tab');
  // Said when the search box could not do what was asked (nothing to open, the reply box cannot take the focus): never a silent no-op.
  const [searchNote, setSearchNote] = useState('');
  // The session whose reply box must take the focus once it exists (the detail pane mounts after the selection changes).
  const [focusWanted, setFocusWanted] = useState<string | undefined>(undefined);
  const [helpOpen, setHelpOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);

  // The message a thread links back to: the source session is opened and its log brings that message into view. `from` is the thread the click came from:
  // the focus lives only while the selection is the source or that thread, so it is cleared on EVERY other selection path (list, back, forget, launch, url).
  const [anchorFocus, setAnchorFocus] = useState<{ sessionId: string; messageId: string; from: string | undefined } | undefined>(undefined);
  useEffect(() => {
    if (anchorFocus !== undefined && selectedId !== anchorFocus.sessionId && selectedId !== anchorFocus.from) {
      setAnchorFocus(undefined);
    }
  }, [anchorFocus, selectedId]);
  // Selecting an agent marked unread reads it (the Herdr behavior); marking the OPEN agent unread keeps the mark, because only a selection clears it.
  const select = useCallback(
    (id: string) => {
      setAnchorFocus(undefined);
      setSessionParam(id);
      const row = rowsRef.current.find((candidate) => agentId(candidate) === id);
      if (row?.unread === true) {
        setMarksRef.current(row.sessionId, { unread: false });
      }
    },
    [setSessionParam],
  );
  const locateAnchor = useCallback(
    (sessionId: string, messageId: string) => {
      setAnchorFocus({ sessionId: sessionId.toLowerCase(), messageId, from: selectedId });
      setSessionParam(sessionId.toLowerCase());
    },
    [setSessionParam, selectedId],
  );
  // A launched session is listed and selected at once, with no registry file yet (the row says it is starting).
  const { apply: applyOwned } = ownedRows;
  const launched = useCallback(
    (session: OwnedSessionDto) => {
      applyOwned({ kind: 'launched', session });
      setSessionParam(session.id.toLowerCase());
    },
    [applyOwned, setSessionParam],
  );

  const act = useCallback(async (path: string, body: unknown, failure: string, onFail: () => void): Promise<void> => {
    const result = await track(requestJson(path, { method: 'POST', body }));
    if (result.ok) {
      setActionError('');
    } else {
      onFail();
      setActionError(`${failure}: ${result.text}`);
    }
  }, [track]);

  const setMarks = useCallback(
    (sessionId: string, marks: { flag?: boolean; unread?: boolean }) => {
      optimistic.patch(sessionId, { kind: 'marks', ...marks });
      void act(`/sessions/${sessionId}/marks`, marks, marks.flag === undefined ? 'Could not change the unread mark' : 'Could not change the flag', () => optimistic.revert(sessionId));
    },
    [act, optimistic],
  );
  setMarksRef.current = setMarks;
  const marksApi = useMemo(() => ({ setMarks }), [setMarks]);

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

  // The batch actions: the same requests as the single ones, one per session (pin and seen are module-local markers, no PIN).
  const pinMany = useCallback(
    (batch: readonly SessionRowDto[], pinned: boolean) => {
      for (const session of batch) {
        pin(session, pinned);
      }
    },
    [pin],
  );
  const seenMany = useCallback(
    (batch: readonly SessionRowDto[]) => {
      for (const session of batch) {
        markSeen(session);
      }
    },
    [markSeen],
  );
  // The pin and seen actions of the "..." menu of a row (the same requests as the header and the batch).
  const rowActionsApi = useMemo(() => ({ pin, seen: markSeen }), [pin, markSeen]);

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

  // Once the reply box of the wanted session exists, it takes the focus. Tried for about half a second (the pane mounts after the selection); a box that cannot
  // take the focus (the session cannot receive messages) or never appears is said, not ignored.
  const selectedSessionId = selected === undefined ? undefined : agentId(selected);
  useEffect(() => {
    if (focusWanted === undefined || selectedSessionId !== focusWanted) {
      return;
    }
    let tries = 0;
    let frame = 0;
    const attempt = (): void => {
      focusComposer();
      if (document.activeElement?.hasAttribute('data-agent-composer') === true) {
        setFocusWanted(undefined);
        return;
      }
      tries += 1;
      if (tries < 30) {
        frame = requestAnimationFrame(attempt);
        return;
      }
      setFocusWanted(undefined);
      const composer = document.querySelector<HTMLTextAreaElement>('[data-agent-composer]');
      setSearchNote(
        composer?.disabled === true
          ? 'The reply box of this agent cannot take the focus because the session cannot receive messages: the message above the box says why.'
          : 'The reply box did not appear, so it could not take the focus. Select the agent again, or reload the page.',
      );
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [focusWanted, selectedSessionId]);

  const List = LISTS[mode];
  // The order comes from the data the list is drawn from, not from the DOM: a closed folder or tab would hide its matches from the keyboard.
  const orderedIds = (): string[] => orderedSessionIds(mode, shownRows, options, tabParam, grouped.api.groups.map((group) => group.id), grouped.api.groups);
  const moveBy = (step: 1 | -1): void => {
    setSearchNote('');
    const target = navTarget(step === 1 ? 'ArrowDown' : 'ArrowUp', orderedIds(), selectedId);
    if (target !== undefined) {
      select(target);
    }
  };
  const openFirst = (): void => {
    setSearchNote('');
    const ids = orderedIds();
    const target = selectedId !== undefined && ids.includes(selectedId) ? selectedId : ids[0];
    if (target === undefined) {
      setSearchNote(
        shownRows.length > 0
          ? `${shownRows.length} agents match, none in the list you are looking at (the ${MODE_LABEL[mode]} view lists only part of them: check the other tabs).`
          : 'No agent matches, so there is nothing to open.',
      );
      return;
    }
    select(target);
    setFocusWanted(target);
  };
  // The rows in the order of the screen first (the batch dialogs list them like the list does), then any other.
  const orderedRows = useMemo(() => {
    const position = new Map(orderedIds().map((id, index) => [id, index]));
    return [...rows].sort((a, b) => (position.get(agentId(a)) ?? Number.MAX_SAFE_INTEGER) - (position.get(agentId(b)) ?? Number.MAX_SAFE_INTEGER));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, shownRows, mode, options, tabParam, grouped.api.groups]);
  let listColumn: ReactNode;
  if (loading) {
    listColumn = (
      <div role="status" aria-label="Loading the sessions" aria-busy="true" className="p-3">
        <Skeleton decorative count={6} height="1.5rem" />
      </div>
    );
  } else if (searching && shownRows.length === 0 && rows.length > 0) {
    listColumn = (
      <EmptyNote
        title={`No agent matches '${searchText.trim()}'`}
        hint={query.problems.length > 0 ? query.problems.join('. ') : 'Check the spelling, or remove a state: or project: filter.'}
        action={
          <ButtonAction variant="secondary" label="Clear the search" onClick={() => setSearchText('')} />
        }
      />
    );
  } else {
    listColumn = (
      <>
        <SelectedBar rows={orderedRows} groups={grouped.api} onPin={pinMany} onSeen={seenMany} />
        <List sessions={shownRows} selectedId={selectedId} onSelect={select} now={now} query={query} searching={searching} options={options} groups={mode === 'tree' || mode === 'custom' ? grouped.api : undefined} marks={marksApi} rowActions={rowActionsApi} />
      </>
    );
  }

  // The problems of the page, behind the notices button of the toolbar (a short title, detail text, copy fix and dismiss per notice): see ui/Notices.tsx.
  const noticeItems: NoticeItem[] = [
    ...(resolvedMode.note === '' ? [] : [{ key: 'mode', tone: 'warning' as const, summary: 'Unknown mode in the address', details: resolvedMode.note, action: { label: 'Remove it from the address', run: () => setModeParam('') } }]),
    ...(searchNote === '' ? [] : [{ key: 'search', tone: 'warning' as const, summary: 'The search could not open an agent', details: searchNote, onDismiss: () => setSearchNote('') }]),
    ...(optionsSaveError === '' ? [] : [{ key: 'view-options', tone: 'warning' as const, summary: 'The view options were not saved', details: optionsSaveError, onDismiss: () => setOptionsSaveError('') }]),
    ...workspaceNotices({ ownedDownText, ownedStateErrorText, unreadableText, guardrailsErrorText, userStateError }),
    ...(actionError === '' ? [] : [{ key: 'action', tone: 'error' as const, summary: actionSummary(actionError), details: actionError, onDismiss: () => setActionError('') }]),
  ];

  let detail: ReactNode;
  if (selected !== undefined) {
    detail = (
      <>
        <DetailHeader session={selected} now={now} busy={busy} onBack={() => setSessionParam('')} onTogglePin={(pinned) => pin(selected, pinned)} onMarkSeen={() => markSeen(selected)} onOwnedChange={applyOwned} onForgotten={() => setSessionParam('')} onForked={launched} onOpenSource={select} onLocateAnchor={locateAnchor} {...(selected.forkedFrom === undefined ? {} : { forkedFrom: { id: selected.forkedFrom, name: rowsById.get(selected.forkedFrom.toLowerCase())?.displayName } })} />
        <AgentDetail session={selected} onThreadStarted={launched} {...(anchorFocus !== undefined && anchorFocus.sessionId === selected.sessionId.toLowerCase() ? { focusMessageId: anchorFocus.messageId } : {})} />
      </>
    );
  } else if (selectedId !== undefined && !loading) {
    detail = (
      <div className="flex flex-1 flex-col items-start gap-3 p-4">
        <Banner tone="warning">The session {selectedId} is not in the list: it may have ended, or the filter above hides the ended sessions.</Banner>
        <ButtonAction variant="secondary" label="Close this session" onClick={() => setSessionParam('')} />
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
    <SelectionProvider existing={existingIds}>
    <SelectionKeys />
    <DaemonStateProvider down={ownedError?.code === 'daemon-not-running'}>
    <LiveThreadsProvider count={liveThreads}>
    {/* The reply box stays above the floating batch popup while sessions are selected (BatchPopup publishes the room). */}
    <div ref={root} data-agent-workspace="" style={{ paddingBottom: 'var(--batch-popup-reserve, 0px)' }} className="flex min-h-0 flex-col bg-surface">
      <Toolbar
        count={rows.length}
        hiddenDead={hiddenDead}
        show={show}
        onShow={(value) => setShowParam(value === 'all' ? 'all' : '')}
        mode={mode}
        onMode={changeMode}
        options={options}
        onOptions={changeOptions}
        search={{ text: searchText, onText: setSearchText, shown: shownRows.length, total: rows.length, problems: query.problems, onMove: moveBy, onEnter: openFirst }}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
        detailOpen={selectedId !== undefined}
        notices={<NoticesButton items={noticeItems} />}
        selectableIds={orderedIds()}
      />
      {launchOpen ? <NewSessionDialog ownedError={ownedError} ownedErrorText={ownedErrorText} onClose={() => setLaunchOpen(false)} onLaunched={launched} /> : null}
      <div className="min-h-0 flex-1">
        <SplitPane
          list={
            <>
              {/* The list (or its loading and empty states) takes the room, the footer keeps its own line under it. */}
              <div className="flex min-h-0 flex-1 flex-col">{listColumn}</div>
              <ListFooter onNewSession={() => setLaunchOpen(true)} {...(mode === 'tree' || mode === 'custom' ? { onNewGroup: async (name: string) => (await grouped.api.create(name)) !== undefined } : {})} />
            </>
          }
          detail={detail} detailOpen={selectedId !== undefined} />
      </div>
    </div>
    </LiveThreadsProvider>
    </DaemonStateProvider>
    </SelectionProvider>
  );
}
