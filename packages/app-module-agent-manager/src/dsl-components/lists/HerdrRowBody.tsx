import { Bot, ChevronDown, ChevronRight, Flag, FolderInput, MoreHorizontal, Pin } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { herdrRowShape, type HerdrDensity } from '../logic/herdrRow.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { Tooltip } from '../ui/Tooltip.js';
import { Highlight } from './Highlight.js';
import { HerdrLightView } from './HerdrLightView.js';
import { HerdrProgramIcon } from './HerdrProgramIcon.js';
import { GuardrailChip } from '../guardrails/GuardrailChip.js';
import { TimeInState } from './TimeInState.js';

/** The separator between the name and the folder (U+00B7), built from its code so that the source stays ASCII. */
const MIDDLE_DOT = String.fromCharCode(0xb7);

export interface HerdrRowBodyProps {
  session: AgentRow;
  density: HerdrDensity;
  now: number;
  terms: readonly string[] | undefined;
  /** The sub-agents of the row: open or closed; undefined when it has none. */
  subagents: { open: boolean; toggle: () => void } | undefined;
  /** Opens the Move to a group dialog; undefined when there are no custom groups API. */
  onMove: (() => void) | undefined;
  /** Opens the menu of the row (flag, unread, move): the kebab button; undefined when the list has none. */
  onMenu?: (anchor: { x: number; y: number }) => void;
}

/**
 * The content of an agent row in the Herdr variants of the A/B question `ui-tree-density`: program icon, bold name, muted middle dot and folder, the marks
 * (host, pin, sub-agents) then the age and the state light on the right. 31 px high, one line, like the Herdr panel. The row click and keyboard are the Tree's.
 */
export function HerdrRowBody({ session, density, now, terms, subagents, onMove, onMenu }: HerdrRowBodyProps) {
  const showFolder = herdrRowShape(density).folder && session.folder !== session.displayName;
  return (
    <div className="flex h-full items-center gap-2">
      {/* The slot is always there, with or without sub-agents: the state icon and the name start at the same x on every row. */}
      <span data-row-chevron-slot="" className="-ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center">
      {subagents !== undefined ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={subagents.open ? `Hide the ${session.subagentCount} sub-agents` : `Show the ${session.subagentCount} sub-agents`}
          onClick={(event) => {
            event.stopPropagation();
            subagents.toggle();
          }}
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-muted-bg hover:text-content ${FOCUS_RING}`}
        >
          {subagents.open ? <ChevronDown aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" /> : <ChevronRight aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />}
        </button>
      ) : null}
      </span>
      <HerdrProgramIcon session={session} />
      {/* The name comes first: it takes what it needs up to the whole box. The folder wraps out of the one-line clipped box (never squeezes the name) when less than its minimum is left. */}
      <span className="flex h-5 min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 overflow-hidden leading-5" title={session.displayName}>
        <span data-herdr-name="" className="min-w-0 max-w-full truncate font-semibold text-content">
          <Highlight text={session.displayName} terms={terms} />
        </span>
        {showFolder ? (
          <span data-herdr-folder="" className="min-w-[7ch] shrink grow basis-[7ch] truncate text-xs text-muted-tint" title={session.folder}>
            {`${MIDDLE_DOT} `}
            <Highlight text={session.folder} terms={terms} />
          </span>
        ) : null}
      </span>
      {session.flagged ? (
        <span className="inline-flex shrink-0 text-hue-orange">
          <Flag aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          <span className="sr-only">Flagged</span>
        </span>
      ) : null}
      {/* Only what the row cannot say otherwise: the host is in the tooltip of the program icon, the waiting state is the light. */}
      <GuardrailChip blocks={session.guardrailBlocks} />
      {session.pinned ? (
        <span className="inline-flex shrink-0 text-muted">
          <Pin aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          <span className="sr-only">Pinned</span>
        </span>
      ) : null}
      {session.subagentCount > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted">
          <Bot aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          <span aria-label={`${session.subagentCount} sub-agents`}>{session.subagentCount}</span>
        </span>
      ) : null}
      {/* The hover buttons float over the age and the light: a hidden slot in the flow would take the width of the name. */}
      {onMove !== undefined || onMenu !== undefined ? (
        <span data-herdr-actions="" className="absolute right-7 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded bg-surface px-0.5 shadow-sm ring-1 ring-border group-focus-within:flex group-hover:flex">
        {onMove !== undefined ? (
          <Tooltip content="Move to a group (M)" side="left">
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Move ${session.displayName} to a group`}
              onClick={(event) => {
                event.stopPropagation();
                onMove();
              }}
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-muted-bg hover:text-content ${FOCUS_RING}`}
            >
              <FolderInput aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            </button>
          </Tooltip>
        ) : null}
        {onMenu !== undefined ? (
          <Tooltip content="Flag, mark as unread, move (right-click)" side="left">
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Actions of ${session.displayName}`}
              aria-haspopup="menu"
              onClick={(event) => {
                event.stopPropagation();
                const box = event.currentTarget.getBoundingClientRect();
                onMenu({ x: box.left, y: box.bottom + 2 });
              }}
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-muted-bg hover:text-content ${FOCUS_RING}`}
            >
              <MoreHorizontal aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            </button>
          </Tooltip>
        ) : null}
        </span>
      ) : null}
      <TimeInState session={session} now={now} />
      <HerdrLightView session={session} />
    </div>
  );
}
