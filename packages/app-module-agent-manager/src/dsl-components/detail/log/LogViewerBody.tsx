import { ArrowDown, ChevronUp, LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Banner } from '../deps.js';
import { FOCUS_RING } from '../deps.js';
import { useMinWidth, useNow } from '../deps.js';
import { settlePending, useDelivery, usePending } from '../pending.js';
import { RowFrame } from './frames.js';
import { buildRows, toggleOpen, type Row } from './grouping.js';
import { drawable, reconcilePending } from './reconcile.js';
import { hideWebQueueLines } from './webQueue.js';
import { describePending, describeRow, type OpenContext } from './rowModel.js';
import { BOTTOM_SLACK_PX, LOG_ICON, LOG_META, TOP_LOAD_PX } from './sizes.js';
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

export function LogViewerBody({ session }: LogViewerProps) {
  const { state, problem, loadingOlder, retry, loadOlder, loadOlderUntil } = useLog(session.sessionId);
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
  const hot = useMemo(() => new Set(agent === undefined || locate.state.phase !== 'found' ? [] : rows.filter((row) => rowMatches(row, agent)).map((row) => row.key)), [agent, rows, locate.state.phase]);

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
    <button type="button" onClick={retry} className={`inline-flex shrink-0 items-center gap-1 rounded border border-danger px-2 py-0.5 ${LOG_META} ${FOCUS_RING}`}>
      <RefreshCw aria-hidden="true" className={LOG_ICON} />
      Retry
    </button>
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
              <button type="button" onClick={requestOlder} disabled={loadingOlder} className={`mb-2 inline-flex shrink-0 items-center justify-center gap-1.5 self-center rounded border border-border px-3 py-1 ${LOG_META} text-muted hover:bg-muted-bg hover:text-content disabled:cursor-wait ${FOCUS_RING}`}>
                {loadingOlder ? <LoaderCircle aria-hidden="true" className={`${LOG_ICON} animate-spin motion-reduce:animate-none`} /> : <ChevronUp aria-hidden="true" className={LOG_ICON} />}
                {loadingOlder ? 'Loading older entries' : 'Load older entries'}
              </button>
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
                <div key={hot.has(row.key) ? `${row.key}:${locate.pulse}` : row.key} data-row-key={row.key} data-hot={hot.has(row.key) ? 'true' : undefined} className={hot.has(row.key) ? 'animate-am-pulse rounded-lg motion-reduce:animate-none' : undefined}>
                  <RowFrame
                    model={describeRow(row, deliveryOf)}
                    sig={row.type === 'group' ? [...row.calls, ...row.calls.map((call) => open.has(call.key))] : row.entry.kind === 'user-prompt' && row.entry.webReply !== undefined ? [row.entry, delivery.get(row.entry.webReply.messageId)] : row.entry}
                      open={open.has(row.key)}
                    onToggle={toggle}
                    context={context}
                    now={now}
                    highlighted={hot.has(row.key)}
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
            <button
              type="button"
              onClick={toBottom}
              className={`absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary-solid px-3 py-1.5 ${LOG_META} text-bg shadow-lg ${FOCUS_RING}`}
            >
              <ArrowDown aria-hidden="true" className={LOG_ICON} />
              {unseen} new {unseen === 1 ? 'entry' : 'entries'}
            </button>
          ) : null}
        </div>
      </div>
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
