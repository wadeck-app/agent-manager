import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { ArrowDown, ChevronUp, LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Banner, ThreadDialog } from '../deps.js';
import { FOCUS_RING } from '../deps.js';
import { useMinWidth, useNow } from '../deps.js';
import { settlePending, useDelivery, usePending } from '../pending.js';
import { RowFrame } from './frames.js';
import { buildRows, toggleOpen, type Row } from './grouping.js';
import { drawable, reconcilePending } from './reconcile.js';
import { hideWebQueueLines } from './webQueue.js';
import { describePending, describeRow, type OpenContext } from './rowModel.js';
import { BOTTOM_SLACK_PX, LOCATE_MAX_PAGES, LOG_ICON, LOG_META, TOP_LOAD_PX } from './sizes.js';
import { LocateBanner, locateAnnouncement } from './LocateBanner.js';
import { publishLogStatus } from '../status/useSessionStatus.js';
import { SubagentAside } from './SubagentAside.js';
import { PANEL_OPEN_MIN_PX, useSubagentPrefs } from './subagentPrefs.js';
import { flattenSubagents } from './subagentModel.js';
import { useLocateCall } from './useLocateCall.js';
import { useLog } from './useLog.js';
import type { LogViewerProps } from './logViewerTypes.js';

/** True when the row (a call, or a group of calls) holds the tool call that started the sub-agent. */
function rowMatches(row: Row, agent: { agentId: string; toolUseId?: string | undefined }): boolean {
  const hit = (call: { id: string; subagentId?: string | undefined }): boolean => call.id === agent.toolUseId || call.subagentId === agent.agentId;
  if (row.type === 'group') {
    return row.calls.some(hit);
  }
  return row.entry.kind === 'tool-call' && hit(row.entry);
}

export const ANCHOR_NOT_IN_LOG =
  'The message this thread was started from is not in the log: the transcript of the original may have been rewritten, or the message is further back than the pages searched. Open the original and scroll to it by hand.';

/** What the banner says when the search for the anchor row ended without it: the three outcomes are told apart, each with what to do. */
function anchorNoteOf(ended: { kind: 'exhausted' | 'bound' | 'error'; message?: string; hint?: string }): { tone: 'warning' | 'error'; text: string } {
  if (ended.kind === 'error') {
    return { tone: 'error', text: `Looking for the message this thread was started from failed: ${ended.message ?? 'unknown error'} ${ended.hint ?? ''}`.trim() };
  }
  if (ended.kind === 'bound') {
    return { tone: 'warning', text: `The search stopped after ${LOCATE_MAX_PAGES} pages without finding the message this thread was started from. Use "Load older entries" at the top of the log to keep going, or open the original and scroll to it by hand.` };
  }
  return { tone: 'warning', text: ANCHOR_NOT_IN_LOG };
}

export function LogViewerBody({ session, onThreadStarted, focusMessageId }: LogViewerProps) {
  const { state, problem, loadingOlder, retry, loadOlder, loadOlderUntil } = useLog(session.sessionId);
  // The Thread dialog: opened on a message row, closed when it starts the thread (the page then selects it) or is cancelled.
  const [threadAnchor, setThreadAnchor] = useState<{ uuid: string; text: string } | undefined>(undefined);
  const openThread = useCallback((anchor: { uuid: string; text: string }) => setThreadAnchor(anchor), []);
  const now = useNow(15_000);
  // The header (outside this component) shows the live status line data: hand it each answer, and forget it when this session is left.
  const sessionId = session.sessionId;
  useEffect(() => {
    publishLogStatus(sessionId, state.status);
  }, [sessionId, state.status]);
  useEffect(() => () => publishLogStatus(sessionId, undefined), [sessionId]);
  // The panel starts collapsed on a window narrower than PANEL_OPEN_MIN_PX (the log keeps its room) until the user chooses; the choice is remembered.
  const roomy = useMinWidth(PANEL_OPEN_MIN_PX);
  const { prefs, change: changePrefs, problem: prefsProblem, dismissProblem } = useSubagentPrefs();
  // A selection (a click on a sub-agent, a search for its call) must be seen: a collapsed panel opens for it WITHOUT touching the saved preference. Collapsing or
  // opening it by hand is the user's choice and is saved.
  const [forcedOpen, setForcedOpen] = useState(false);
  const pending = usePending(session.sessionId);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const anchor = useRef<{ height: number; top: number; firstKey: string | undefined } | null>(null);
  const [seenMark, setSeenMark] = useState(0);

  const { echoed, waiting } = useMemo(() => reconcilePending(state.entries, pending), [state.entries, pending]);
  useEffect(() => {
    for (const message of echoed) {
      settlePending(session.sessionId, message.messageId);
    }
  }, [echoed, session.sessionId]);

  const delivery = useDelivery(session.sessionId);
  const deliveryOf = useCallback((messageId: string) => delivery.get(messageId), [delivery]);
  // The queue lines of a message sent from here are redundant with its bubble: not drawn.
  const rows = useMemo(() => buildRows(hideWebQueueLines(state.entries)), [state.entries]);
  const shownPending = useMemo(() => drawable(waiting, now), [waiting, now]);
  const toggle = useCallback((key: string) => setOpen((current) => toggleOpen(current, key)), []);
  const context = useMemo<OpenContext>(() => ({ isOpen: (key) => open.has(key), toggle }), [open, toggle]);
  // A call that failed makes the sub-agent it started count as failed, whatever the meta of the sub-agent says.
  const failedCalls = useMemo(() => new Set(state.entries.flatMap((entry) => (entry.kind === 'tool-call' && entry.status === 'error' ? [entry.id] : []))), [state.entries]);
  const items = useMemo(() => flattenSubagents(state.subagents, failedCalls), [state.subagents, failedCalls]);
  const locate = useLocateCall({ sessionId: session.sessionId, entries: state.entries, items, loadOlderUntil });
  useEffect(() => {
    if (locate.selectedId !== undefined) {
      setForcedOpen(true);
    }
  }, [locate.selectedId]);
  const agent = useMemo(() => (locate.selectedId === undefined ? undefined : items.find((item) => item.dto.agentId === locate.selectedId)?.dto), [locate.selectedId, items]);
  // The rows of the call that started the selected sub-agent: highlighted once it is shown (not while it is being looked for).
  const subagentHot = useMemo(() => new Set(agent === undefined || locate.state.phase !== 'found' ? [] : rows.filter((row) => rowMatches(row, agent)).map((row) => row.key)), [agent, rows, locate.state.phase]);

  // The link back from a thread: the row of the anchor message. Searched in the loaded entries, then in older pages (bounded, once per message); said when absent.
  const focusRowKey = useMemo(() => (focusMessageId === undefined ? undefined : rows.find((row) => row.type === 'entry' && row.entry.uuid === focusMessageId)?.key), [focusMessageId, rows]);
  const [focusPulse, setFocusPulse] = useState(0);
  const [searchEnded, setSearchEnded] = useState<{ id: string; kind: 'exhausted' | 'bound' | 'error'; message?: string; hint?: string } | undefined>(undefined);
  const pulsedFor = useRef<string | undefined>(undefined);
  const searchedFor = useRef<string | undefined>(undefined);
  const searchAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (focusMessageId === undefined || !state.loaded) {
      return;
    }
    if (focusRowKey !== undefined) {
      if (pulsedFor.current !== focusMessageId) {
        pulsedFor.current = focusMessageId;
        setFocusPulse((current) => current + 1);
      }
      return;
    }
    if (searchedFor.current === focusMessageId) {
      return;
    }
    searchedFor.current = focusMessageId;
    if (state.olderCursor === null) {
      setSearchEnded({ id: focusMessageId, kind: 'exhausted' });
      return;
    }
    // The search loads page after page, which changes `state.olderCursor`: it must not be cancelled by this effect running again (only a new message or the end of the viewer ends it).
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    // Stops at the page that holds the message (stopWhen), never pages on after it; the end of the transcript, the page bound and a failed page are three different notes.
    const focusId = focusMessageId;
    void loadOlderUntil(0, { signal: controller.signal, maxPages: LOCATE_MAX_PAGES, onPage: () => undefined, stopWhen: (page) => page.some((entry) => entry.uuid === focusId) }).then((result) => {
      if (result.status === 'error') {
        setSearchEnded({ id: focusId, kind: 'error', message: result.message, hint: result.hint });
      } else if (result.status === 'bound') {
        setSearchEnded({ id: focusId, kind: 'bound' });
      } else if (result.status === 'start' || result.status === 'reached') {
        // Everything was loaded (or the message was in the last page: then its row exists and the note is not shown).
        setSearchEnded({ id: focusId, kind: 'exhausted' });
      }
    });
  }, [focusMessageId, focusRowKey, state.loaded, state.olderCursor, loadOlderUntil]);
  useEffect(() => () => searchAbort.current?.abort(), []);
  useEffect(() => {
    if (focusPulse === 0) {
      return;
    }
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = window.requestAnimationFrame(() => scroller.current?.querySelector('[data-focus-hot="true"]')?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusPulse]);
  const anchorNote = focusMessageId === undefined || focusRowKey !== undefined || searchEnded?.id !== focusMessageId ? undefined : anchorNoteOf(searchEnded);
  const hot = useMemo(() => (focusRowKey !== undefined && focusPulse > 0 ? new Set([...subagentHot, focusRowKey]) : subagentHot), [subagentHot, focusRowKey, focusPulse]);

  const requestOlder = useCallback(() => {
    const element = scroller.current;
    if (element !== null) {
      anchor.current = { height: element.scrollHeight, top: element.scrollTop, firstKey: state.entries[0]?.key };
    }
    loadOlder();
  }, [loadOlder, state.entries]);

  // Follows the newest entry only while the user is at the bottom; keeps the place when older entries are put in front.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    const held = anchor.current;
    if (held !== null && state.entries[0]?.key !== held.firstKey) {
      element.scrollTop = element.scrollHeight - held.height + held.top;
      anchor.current = null;
    } else if (stick.current) {
      element.scrollTop = element.scrollHeight;
      setSeenMark(state.appended);
    }
    if (held !== null && !loadingOlder) {
      anchor.current = null;
    }
  }, [state.entries, state.appended, waiting.length, loadingOlder]);

  // The call comes into view, every time it is shown (a second click on the same sub-agent shows it again). A group of calls that holds it opens.
  useEffect(() => {
    if (locate.pulse === 0 || agent === undefined) {
      return;
    }
    setOpen((current) => {
      const next = new Set(current);
      for (const row of rows) {
        if (rowMatches(row, agent)) {
          next.add(row.key);
          if (row.type === 'group') {
            row.calls.filter((call) => call.id === agent.toolUseId || call.subagentId === agent.agentId).forEach((call) => next.add(call.key));
          }
        }
      }
      return next;
    });
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // After the open set is rendered: the row is taller once the group opens.
    const frame = window.requestAnimationFrame(() => scroller.current?.querySelector('[data-hot="true"]')?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }));
    return () => window.cancelAnimationFrame(frame);
    // Only a new "shown" event moves the log: the rows and the agent are read as they are at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locate.pulse]);

  const onScroll = (): void => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    stick.current = element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX;
    if (stick.current) {
      setSeenMark(state.appended);
    }
    if (element.scrollTop < TOP_LOAD_PX && state.olderCursor !== null && !loadingOlder) {
      requestOlder();
    }
  };

  const toBottom = (): void => {
    const element = scroller.current;
    if (element !== null) {
      stick.current = true;
      element.scrollTop = element.scrollHeight;
      setSeenMark(state.appended);
    }
  };

  const unseen = Math.max(0, state.appended - seenMark);
  const retryButton = (
<ButtonAction variant="secondary" size="sm" icon={<RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />} label="Retry" onClick={retry} />
  );
  const cut = state.truncated;
  const showAside = items.length > 0;
  const subagentProps = {
    items,
    mode: prefs.mode,
    onMode: (mode: typeof prefs.mode) => changePrefs({ mode }),
    order: prefs.order,
    onOrder: (order: typeof prefs.order) => changePrefs({ order }),
    selectedId: locate.selectedId,
    phase: locate.phase,
    onSelect: locate.select,
    note: state.subagentsNote,
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {items.length === 0 && state.subagentsNote !== '' ? <p className={`border-b border-border px-3 py-1.5 ${LOG_META} text-warning-text`}>{state.subagentsNote}</p> : null}
        {anchorNote !== undefined ? (
          <div className="px-3 pt-2">
            <Banner tone={anchorNote.tone}>{anchorNote.text}</Banner>
          </div>
        ) : null}
        <LocateBanner feed={locate} />
        <p role="status" aria-live="polite" className="sr-only">
          {locateAnnouncement(locate)}
        </p>
        {problem !== undefined ? (
          <div className="px-3 pt-2">
            <Banner tone="error" action={retryButton}>
              <span className="font-medium">{problem.source === 'older' ? 'Older entries could not be loaded. ' : state.loaded ? 'The log could not be refreshed, the entries below are the last ones received. ' : 'The log could not be loaded. '}</span>
              {problem.message} {problem.hint}
            </Banner>
          </div>
        ) : null}
        <div className="relative min-h-0 flex-1">
          <div ref={scroller} onScroll={onScroll} role="log" aria-label={`Log of ${session.displayName}`} aria-live="off" tabIndex={0} className={`absolute inset-0 flex flex-col overflow-y-auto px-4 py-3 ${FOCUS_RING}`}>
            {state.olderCursor !== null ? (
              <span className="mb-2 flex shrink-0 justify-center">
                <ButtonAction variant="secondary" size="sm" loading={loadingOlder} icon={<ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />} label={loadingOlder ? 'Loading older entries' : 'Load older entries'} onClick={requestOlder} />
              </span>
            ) : state.loaded && state.entries.length > 0 ? (
              <p className={`mb-2 text-center ${LOG_META} text-muted`}>Start of the transcript</p>
            ) : null}
            {!state.loaded && problem === undefined ? (
              <p className={`flex items-center justify-center gap-2 py-8 ${LOG_META} text-muted`} role="status">
                <LoaderCircle aria-hidden="true" className={`${LOG_ICON} animate-spin motion-reduce:animate-none`} />
                Loading the log
              </p>
            ) : null}
            {state.loaded && state.entries.length === 0 && shownPending.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">{state.note !== '' ? state.note : 'The transcript has no entry yet.'}</p>
            ) : null}
            <div className={`mx-auto flex w-full max-w-am-log flex-col gap-2`}>
              {rows.map((row) => (
                // A new key at each "shown" event restarts the pulse animation on the same row.
                <div
                  key={hot.has(row.key) ? `${row.key}:${locate.pulse}:${focusPulse}` : row.key}
                  data-row-key={row.key}
                  data-hot={hot.has(row.key) ? 'true' : undefined}
                  data-focus-hot={row.key === focusRowKey && focusPulse > 0 ? 'true' : undefined}
                  className={hot.has(row.key) ? 'animate-am-pulse rounded-lg motion-reduce:animate-none' : undefined}
                >
                  <RowFrame
                    model={describeRow(row, deliveryOf)}
                    sig={row.type === 'group' ? [...row.calls, ...row.calls.map((call) => open.has(call.key))] : row.entry.kind === 'user-prompt' && row.entry.webReply !== undefined ? [row.entry, delivery.get(row.entry.webReply.messageId)] : row.entry}
                      open={open.has(row.key)}
                    onToggle={toggle}
                    context={context}
                    now={now}
                    highlighted={hot.has(row.key)}
                    {...(onThreadStarted === undefined ? {} : { onThread: openThread })}
                  />
                </div>
              ))}
              {shownPending.map((message) => (
                <div key={`pending:${message.messageId}`} data-pending="true">
                  <RowFrame model={describePending(message, now)} sig={[message, Math.floor(now / 30_000)]} open={true} onToggle={toggle} context={context} now={now} highlighted={false} />
                </div>
              ))}
            </div>
            {cut !== undefined && (cut.fieldsCut > 0 || cut.bodyCapped || cut.unreadableLines > 0) ? (
              <p className={`mt-2 ${LOG_META} text-muted`}>
                {[
                  cut.fieldsCut > 0 ? `${cut.fieldsCut} entries were shortened by the server` : '',
                  cut.bodyCapped ? 'the answer was cut at its size limit, older entries load with the button above' : '',
                  cut.unreadableLines > 0 ? `${cut.unreadableLines} lines of the transcript could not be read (shown as unrecognised entries)` : '',
                ]
                  .filter(Boolean)
                  .join('; ')}
                .
              </p>
            ) : null}
          </div>
          {unseen > 0 ? (
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg">
              <ButtonAction variant="primary" size="sm" icon={<ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />} label={`${unseen} new ${unseen === 1 ? 'entry' : 'entries'}`} onClick={toBottom} />
            </span>
          ) : null}
        </div>
      </div>
      {threadAnchor !== undefined && onThreadStarted !== undefined ? <ThreadDialog session={session} anchor={threadAnchor} onClose={() => setThreadAnchor(undefined)} onStarted={onThreadStarted} /> : null}
      {showAside ? (
        <SubagentAside
          {...subagentProps}
          collapsed={(prefs.collapsed ?? !roomy) && !forcedOpen}
          onCollapsed={(collapsed) => {
            setForcedOpen(false);
            changePrefs({ collapsed });
          }}
          problem={prefsProblem}
          onDismissProblem={dismissProblem}
        />
      ) : null}
    </div>
  );
}
