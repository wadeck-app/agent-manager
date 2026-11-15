import { ArrowDown, ChevronUp, LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogStyle, SubagentDto } from '../deps.js';
import { Banner } from '../deps.js';
import { FOCUS_RING } from '../deps.js';
import { useMinWidth, useNow, WIDE_SCREEN_PX } from '../deps.js';
import { removePending, usePending } from '../pending.js';
import { RowFrame } from './frames.js';
import { buildRows, toggleOpen, type Row } from './grouping.js';
import { reconcilePending } from './reconcile.js';
import { describePending, describeRow, type OpenContext } from './rowModel.js';
import { BOTTOM_SLACK_PX, LOG_ICON, LOG_META, TOP_LOAD_PX } from './sizes.js';
import { SubagentPanel } from './SubagentPanel.js';
import { SubagentStrip } from './SubagentStrip.js';
import { useLog } from './useLog.js';
import type { LogViewerProps } from './logViewerTypes.js';

const ROW_GAP: Record<LogStyle, string> = { chat: 'gap-2', timeline: 'gap-0', compact: 'gap-0.5' };

function flatten(nodes: readonly SubagentDto[]): SubagentDto[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

function rowMatches(row: Row, agent: SubagentDto): boolean {
  const hit = (call: { id: string; subagentId?: string | undefined }): boolean => call.id === agent.toolUseId || call.subagentId === agent.agentId;
  if (row.type === 'group') {
    return row.calls.some(hit);
  }
  return row.entry.kind === 'tool-call' && hit(row.entry);
}

export function LogViewerBody({ session, logStyle }: LogViewerProps) {
  const { state, problem, loadingOlder, retry, loadOlder } = useLog(session.sessionId);
  const now = useNow(15_000);
  const wide = useMinWidth(WIDE_SCREEN_PX);
  const pending = usePending(session.sessionId);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const anchor = useRef<{ height: number; top: number; firstKey: string | undefined } | null>(null);
  const [seenMark, setSeenMark] = useState(0);

  const { echoed, waiting } = useMemo(() => reconcilePending(state.entries, pending), [state.entries, pending]);
  useEffect(() => {
    for (const message of echoed) {
      removePending(session.sessionId, message.messageId);
    }
  }, [echoed, session.sessionId]);

  const rows = useMemo(() => buildRows(state.entries), [state.entries]);
  const toggle = useCallback((key: string) => setOpen((current) => toggleOpen(current, key)), []);
  const context = useMemo<OpenContext>(() => ({ isOpen: (key) => open.has(key), toggle }), [open, toggle]);
  const agent = useMemo(() => (agentId === undefined ? undefined : flatten(state.subagents).find((node) => node.agentId === agentId)), [agentId, state.subagents]);
  const hot = useMemo(() => new Set(agent === undefined ? [] : rows.filter((row) => rowMatches(row, agent)).map((row) => row.key)), [agent, rows]);

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

  // The highlighted call comes into view.
  useEffect(() => {
    if (agent !== undefined) {
      scroller.current?.querySelector('[data-hot="true"]')?.scrollIntoView({ block: 'center' });
    }
  }, [agent]);

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

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {wide ? null : <SubagentStrip subagents={state.subagents} note={state.subagentsNote} selected={agentId} onSelect={setAgentId} />}
        {agent !== undefined && hot.size === 0 ? (
          <p className={`border-b border-border px-3 py-1 ${LOG_META} text-muted`}>The call that started this sub-agent is not among the entries loaded here. Load older entries or look in the transcript.</p>
        ) : null}
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
            {state.loaded && state.entries.length === 0 && waiting.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">{state.note !== '' ? state.note : 'The transcript has no entry yet.'}</p>
            ) : null}
            <div className={`mx-auto flex w-full max-w-am-log flex-col ${ROW_GAP[logStyle]}`}>
              {rows.map((row) => (
                <div key={row.key} data-row-key={row.key} data-hot={hot.has(row.key) ? 'true' : undefined}>
                  <RowFrame
                    model={describeRow(row)}
                    sig={row.type === 'group' ? [...row.calls, ...row.calls.map((call) => open.has(call.key))] : row.entry}
                    style={logStyle}
                    open={open.has(row.key)}
                    onToggle={toggle}
                    context={context}
                    now={now}
                    highlighted={hot.has(row.key)}
                  />
                </div>
              ))}
              {waiting.map((message) => (
                <div key={`pending:${message.messageId}`} data-pending="true">
                  <RowFrame model={describePending(message)} sig={message} style={logStyle} open={true} onToggle={toggle} context={context} now={now} highlighted={false} />
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
      {wide ? <SubagentPanel subagents={state.subagents} note={state.subagentsNote} selected={agentId} onSelect={setAgentId} /> : null}
    </div>
  );
}
