import { ButtonAction, IconButton, Switch, Tooltip } from '@wadeck-app/dsl-ui';
import { ListFilter } from 'lucide-react';
import { useRef, useState } from 'react';
import { ChatLayoutChoices, CountBadge, FloatingPanel, POPUP_SECTION } from '../deps.js';
import { useFilterSummary } from './filterSummary.js';
import { hiddenSentence, NAME } from './filterNames.js';
import { LOG_CATEGORIES, useLogFilters } from './logFilters.js';

const WIDTH = 288;

/**
 * The filter button of the header (top right, next to the other actions of the open agent) and its popup: one switch per family of the log (hooks, tool calls, thinking, queue lines,
 * agent messages) with the number of entries among the loaded ones, "Reset filters", and "Show the filter bar" (the same switches as a bar above the log, off by
 * default). The button carries the number of entries the filters hide, so a log that looks short is never a silent filter. It shares its choices with the log
 * (useLogFilters): a switch here changes the log at once.
 */
export function LogFilterMenu({ sessionId }: { sessionId: string }) {
  const feed = useLogFilters();
  const summary = useFilterSummary(sessionId);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | undefined>(undefined);
  // A press on the button closes the popup (a press outside it); the click that follows must not open it again.
  const wasOpen = useRef(false);
  const hidden = summary?.hiddenTotal ?? 0;
  const label = hidden > 0 ? `Log filters, ${hidden} ${hidden === 1 ? 'entry' : 'entries'} hidden` : 'Log filters';
  const tip =
    summary === undefined ? 'Filter the log (it is loading)' : hidden > 0 ? `Filter the log. Hidden: ${hiddenSentence(summary.hidden)}` : 'Filter the log: nothing is hidden';
  return (
    <>
      <span className="relative inline-flex">
        <IconButton
          tooltip={tip}
          icon={<ListFilter aria-hidden="true" className="h-4 w-4" />}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={anchor !== undefined}
          onPointerDown={() => {
            wasOpen.current = anchor !== undefined;
          }}
          onClick={(event) => {
            if (wasOpen.current) {
              wasOpen.current = false;
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            setAnchor({ x: rect.right - WIDTH, y: rect.bottom + 4 });
          }}
        />
        {hidden > 0 ? (
          <CountBadge tone="primary" data-filter-badge="" aria-hidden="true" className="pointer-events-none absolute -right-1 -top-1">
            {hidden}
          </CountBadge>
        ) : null}
      </span>
      {anchor === undefined ? null : (
        <FloatingPanel x={anchor.x} y={anchor.y} width={WIDTH} label="Log filters" onClose={() => setAnchor(undefined)}>
          <p className="px-1 pb-0.5 text-xs font-semibold text-muted">Show in the log</p>
          <div role="group" aria-label="Show in the log" className="flex flex-col">
            {LOG_CATEGORIES.map((category) => (
              <div key={category} data-filter-row={category} className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-muted-bg">
                <Switch size="sm" label={NAME[category].label} checked={feed.prefs[category]} onChange={(on) => feed.change({ [category]: on })} />
                <Tooltip content={`${summary?.counts[category] ?? 'No'} ${NAME[category].plural} in the loaded entries`}>
                  <span className="text-xs tabular-nums text-muted">{summary === undefined ? '-' : summary.counts[category]}</span>
                </Tooltip>
              </div>
            ))}
          </div>
          <div className={`mt-1 flex flex-col gap-0.5 ${POPUP_SECTION} pt-2`}>
            <p className="px-1 pb-0.5 text-xs font-semibold text-muted">Tool calls</p>
            <div data-grouping-row="" className="flex flex-col gap-0.5 rounded px-1 py-1 hover:bg-muted-bg">
              <Switch size="sm" label="Group consecutive calls" checked={feed.grouped} onChange={feed.setGrouped} />
              <span className="pl-11 text-xs text-muted">{feed.grouped ? 'On: a run of tool calls or agent calls is one row' : 'Off: one row per tool call or agent call'}</span>
            </div>
          </div>
          <div className={`mt-1 flex flex-col gap-1 ${POPUP_SECTION} pt-2`}>
            <div className="px-1">
              <ButtonAction
                variant="secondary"
                size="sm"
                label="Reset filters"
                disabled={feed.isDefault}
                disabledReason={feed.isDefault ? 'The filters are at their defaults' : undefined}
                onClick={feed.reset}
              />
            </div>
            <div className="flex flex-col gap-0.5 rounded px-1 py-1 hover:bg-muted-bg">
              <Switch size="sm" label="Show the filter bar" checked={feed.showBar} onChange={feed.setShowBar} />
              <span className="pl-11 text-xs text-muted">The same switches as a bar above the log</span>
            </div>
          </div>
          <div data-chat-section="" className={`mt-1 flex flex-col gap-0.5 ${POPUP_SECTION} pt-2`}>
            <p className="px-1 pb-0.5 text-xs font-semibold text-muted">Chat layout</p>
            <ChatLayoutChoices name="log-chat-layout" />
          </div>
          {feed.problem === '' ? null : (
            <p role="alert" className="px-1 pt-1 text-xs text-warning-text">
              {feed.problem}
            </p>
          )}
        </FloatingPanel>
      )}
    </>
  );
}
