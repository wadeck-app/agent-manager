import { Bot, ChevronDown, ChevronRight, Flag, FolderInput, MoreHorizontal, Pin } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { herdrRowShape, type HerdrDensity } from '../logic/herdrRow.js';
import { Tooltip } from '../ui/Tooltip.js';
import { Highlight } from './Highlight.js';
import { HerdrLightView } from './HerdrLightView.js';
import { HerdrProgramIcon } from './HerdrProgramIcon.js';
import { GuardrailChip } from '../guardrails/GuardrailChip.js';
import { TimeInState } from './TimeInState.js';
import { RowIconButton } from './RowIconButton.js';

/** The separator between the name and the folder (U+00B7), built from its code so that the source stays ASCII. */
const MIDDLE_DOT = String.fromCharCode(0xb7);

export interface HerdrRowBodyProps {
  session: AgentRow;
  density: HerdrDensity;
  /** The open row: its name is semibold and never grey (the Herdr WAgents mod). */
  selected?: boolean;
  now: number;
  terms: readonly string[] | undefined;
  /** The list shows sub-agents under its agents (view option): the chevron slot is reserved on every row. False: no slot on any row. */
  showSlot: boolean;
  /** The sub-agents of the row: open or closed; undefined when it has none (or when the list does not show them). */
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
export function HerdrRowBody({ session, density, selected = false, now, terms, showSlot, subagents, onMove, onMenu }: HerdrRowBodyProps) {
  // Herdr: a quiet agent (idle, not open, not marked unread) has a grey name; every other one is white.
  const quiet = session.state === 'idle' && !selected && !session.unread;
  const showFolder = herdrRowShape(density).folder && session.folder !== session.displayName;
  return (
    <div className="flex h-full items-center gap-[9px] text-[13px] leading-5">
      {/* The slot is on every row of a list that shows sub-agents, with or without any: the state icon and the name start at the same x on every row. A list that does not show them has no slot on any row. It is 20 px wide (the 28 px button overflows it evenly) so that the name keeps the room. */}
      {showSlot ? (
      <span data-row-chevron-slot="" className="-ml-1 -mr-1 inline-flex h-7 w-5 shrink-0 items-center justify-center">
      {subagents !== undefined ? (
        <RowIconButton
          label={subagents.open ? `Hide the ${session.subagentCount} sub-agents` : `Show the ${session.subagentCount} sub-agents`}
          onClick={() => subagents.toggle()}
          icon={subagents.open ? <ChevronDown aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" /> : <ChevronRight aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />}
        />
      ) : null}
      </span>
      ) : null}
      <HerdrProgramIcon session={session} />
      {/* The name comes first: it takes what it needs up to the whole box. The folder wraps out of the one-line clipped box (never squeezes the name) when less than its minimum is left. */}
      <span className="flex h-5 min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 overflow-hidden leading-5" title={session.displayName}>
        <span data-herdr-name="" className={`min-w-0 max-w-full truncate ${selected ? 'font-semibold text-content' : 'font-normal'} ${quiet ? 'text-muted-tint' : 'text-content'}`}>
          <Highlight text={session.displayName} terms={terms} />
        </span>
        {/* The sub-agent count is secondary: in the clipped box it wraps out (after the folder) when the name needs the room. */}
        {session.subagentCount > 0 ? (
          <span data-herdr-subagents="" className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-tint">
            <Bot aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            <span aria-label={`${session.subagentCount} sub-agents`}>{session.subagentCount}</span>
          </span>
        ) : null}
        {showFolder ? (
          <span data-herdr-folder="" className="min-w-[7ch] shrink grow basis-[7ch] truncate text-[13px] text-muted-tint" title={session.folder}>
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
        <span className="inline-flex shrink-0 text-muted-tint">
          <Pin aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          <span className="sr-only">Pinned</span>
        </span>
      ) : null}
      {/* The hover buttons float over the age and the light: a hidden slot in the flow would take the width of the name. */}
      {onMove !== undefined || onMenu !== undefined ? (
        <span data-herdr-actions="" className="absolute right-[30px] top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded bg-surface px-0.5 shadow-sm ring-1 ring-border group-focus-within:flex group-hover:flex">
        {onMove !== undefined ? (
          <Tooltip content="Move to a group (M)" side="left">
            <RowIconButton label={`Move ${session.displayName} to a group`} onClick={() => onMove()} icon={<FolderInput aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />} />
          </Tooltip>
        ) : null}
        {onMenu !== undefined ? (
          <Tooltip content="Flag, mark as unread, move (right-click)" side="left">
            <RowIconButton
              label={`Actions of ${session.displayName}`}
              aria-haspopup="menu"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                onMenu({ x: box.left, y: box.bottom + 2 });
              }}
              icon={<MoreHorizontal aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />}
            />
          </Tooltip>
        ) : null}
        </span>
      ) : null}
      <TimeInState session={session} now={now} className="text-[11px]" />
      <HerdrLightView session={session} />
    </div>
  );
}
