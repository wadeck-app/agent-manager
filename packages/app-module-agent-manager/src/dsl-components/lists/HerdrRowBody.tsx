import { ChevronDown, ChevronRight, Flag, Pin } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { herdrRowShape, type HerdrDensity } from '../logic/herdrRow.js';
import { detailLine } from './common.js';
import { Highlight } from './Highlight.js';
import { RowTip } from './RowTip.js';
import { HerdrLightView } from './HerdrLightView.js';
import { HerdrProgramIcon } from './HerdrProgramIcon.js';
import { GuardrailChip } from '../guardrails/GuardrailChip.js';
import { TimeInState } from './TimeInState.js';
import { RowIconButton } from './RowIconButton.js';
import { RowMenuButton } from './RowMenuButton.js';
import { InlineSecondary, SECONDARY_BOX } from './RowSecondary.js';
import { isQuietRow, nameClasses } from '../logic/rowLook.js';
import { useRowLook } from './RowLookContext.js';

const ROW_LINE = 'flex h-5 min-w-0 flex-1 flex-wrap items-center gap-x-2 overflow-hidden leading-5';

export interface HerdrRowBodyProps {
  session: AgentRow;
  density: HerdrDensity;
  /** The row sits under the header of its own folder: the folder text would repeat the header, so it is not written. */
  hideFolder?: boolean;
  /** The open row: its name is semibold and never grey (the Herdr WAgents mod). */
  selected?: boolean;
  now: number;
  terms: readonly string[] | undefined;
  /** The list shows sub-agents under its agents (view option): the chevron slot is reserved on every row. False: no slot on any row. */
  showSlot: boolean;
  /** The sub-agents of the row: open or closed; undefined when it has none (or when the list does not show them). */
  subagents: { open: boolean; toggle: () => void } | undefined;
  /** Opens the menu of the row (move, flag, unread, pin, seen): the always visible "..." button; undefined when the list has no action to offer (no button). */
  onMenu?: (anchor: { x: number; y: number }) => void;
}

/** The box of a bold name grows into the gap on its right by the width the weight adds (classes written in full). */
export const BOLD_NAME_RESERVE = '-mr-1.5';

/**
 * The content of an agent row in the Herdr variants of the A/B question `ui-tree-density`: program icon, bold name, the folder (colour and gap, lists/RowSecondary.tsx), the marks
 * (host, pin, sub-agents) then the age and the state light on the right. 31 px high, one line, like the Herdr panel. The row click and keyboard are the Tree's.
 */
export function HerdrRowBody({ session, density, hideFolder = false, selected = false, now, terms, showSlot, subagents, onMenu }: HerdrRowBodyProps) {
  const showFolder = !hideFolder && herdrRowShape(density).folder && session.folder !== session.displayName;
  // The row look (logic/rowLook.ts): a plain name for every agent by default; the Herdr look (a bold open name, a grey quiet one) is the settings boldActive and dimIdle.
  const look = useRowLook();
  // A bold name is wider than the same name in the regular weight (measured: 139.4 px against 133.5 px for "agent-manager-owner"), and the open row would cut a name
  // that fits when it is not open (QA3 R17): the box of the name takes the 6 px back from the gap on its right (the gap is 9 px), so the weight changes no word on the row.
  // It is the wrapper that grows: the line inside clips at its parent, a margin on the name itself could not widen it.
  const reserve = selected && look.boldActive ? BOLD_NAME_RESERVE : '';
  const nameClass = nameClasses(look, selected, isQuietRow(session, selected), 'regular');
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
      <span data-name-box="" className={`flex min-w-0 flex-1 ${reserve}`}>
      <RowTip session={session} line={detailLine(session)}>
        <span data-tip-fill="" className={ROW_LINE}>
          <span data-herdr-name="" className={`min-w-0 max-w-full truncate ${nameClass}`}>
            <Highlight text={session.displayName} terms={terms} />
          </span>
          {showFolder ? (
            <span data-herdr-folder="" className={`flex shrink grow items-center overflow-hidden text-[13px] ${SECONDARY_BOX}`}>
              <InlineSecondary textClass="text-[13px]">
                <Highlight text={session.folder} terms={terms} />
              </InlineSecondary>
            </span>
          ) : null}
        </span>
      </RowTip>
      </span>
      {session.flagged ? (
        <span className="inline-flex shrink-0 text-hue-orange">
          <Flag aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          <span className="sr-only">Flagged</span>
        </span>
      ) : null}
      {/* Only what the row cannot say otherwise: the host is in the tooltip of the program icon, the waiting state is the light (the red "!" of Needs you has no pill with words here: the names keep that room, D2026-11-26k). */}
      <GuardrailChip blocks={session.guardrailBlocks} />
      {session.pinned ? (
        <span className="inline-flex shrink-0 text-muted-tint">
          <Pin aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          <span className="sr-only">Pinned</span>
        </span>
      ) : null}
      <TimeInState session={session} now={now} className="text-[11px]" />
      {/* After the age, so that the buttons of the rows sit on one vertical line (the light column is fixed). The menu button is always there (no hover reveal: touch and keyboard users never see a hover): one low emphasis "..." that holds every action of the row. */}
      {onMenu === undefined ? null : <RowMenuButton name={session.displayName} onMenu={onMenu} />}
      <HerdrLightView session={session} />
    </div>
  );
}
