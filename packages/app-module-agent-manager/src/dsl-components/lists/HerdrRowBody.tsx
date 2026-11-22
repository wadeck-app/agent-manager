import { Bot, ChevronDown, ChevronRight, FolderInput, Pin } from 'lucide-react';
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
}

/**
 * The content of an agent row in the Herdr variants of the A/B question `ui-tree-density`: program icon, bold name, muted middle dot and folder, the marks
 * (host, pin, sub-agents) then the age and the state light on the right. 31 px high, one line, like the Herdr panel. The row click and keyboard are the Tree's.
 */
export function HerdrRowBody({ session, density, now, terms, subagents, onMove }: HerdrRowBodyProps) {
  const showFolder = herdrRowShape(density).folder && session.folder !== session.displayName;
  return (
    <div className="flex h-full items-center gap-2">
      {subagents !== undefined ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={subagents.open ? `Hide the ${session.subagentCount} sub-agents` : `Show the ${session.subagentCount} sub-agents`}
          onClick={(event) => {
            event.stopPropagation();
            subagents.toggle();
          }}
          className={`-ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-muted-bg hover:text-content ${FOCUS_RING}`}
        >
          {subagents.open ? <ChevronDown aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" /> : <ChevronRight aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />}
        </button>
      ) : null}
      <HerdrProgramIcon session={session} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5" title={session.displayName}>
        <span className="min-w-0 truncate font-semibold text-content">
          <Highlight text={session.displayName} terms={terms} />
        </span>
        {showFolder ? (
          <span className="min-w-0 shrink-[2] truncate text-xs text-muted" title={session.folder}>
            {`${MIDDLE_DOT} `}
            <Highlight text={session.folder} terms={terms} />
          </span>
        ) : null}
      </span>
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
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:bg-muted-bg hover:text-content focus-visible:opacity-100 group-hover:opacity-100 ${FOCUS_RING}`}
          >
            <FolderInput aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          </button>
        </Tooltip>
      ) : null}
      <TimeInState session={session} now={now} />
      <HerdrLightView session={session} />
    </div>
  );
}
