import { Tooltip } from '@wadeck-app/dsl-ui';
import type { AgentRow } from '../data/types.js';
import { herdrLight } from '../logic/herdrRow.js';
import { STATE_MEANING } from '../logic/states.js';
import { StatusColumn } from '../ui/StatusColumn.js';
import { LightNode } from './LightNode.js';

/**
 * The state light on the right of a Herdr row, in the fixed 28 px column of the page (ui/StatusColumn.tsx): every light is centred in the column, so the
 * lights of all the rows and the icons of the group headers sit on one vertical axis. Every state is an icon, so the column never widens.
 */
export function HerdrLightView({ session }: { session: AgentRow }) {
  const light = herdrLight(session.state);
  return (
    <Tooltip content={STATE_MEANING[session.state]} side="left">
      <span className="inline-flex shrink-0">
        <StatusColumn>
          <span data-herdr-light={light.kind} className="inline-flex items-center">
            {/* Needs you is the compact red "!" box, named in words for assistive technology (the visible pill of the row was removed so that the names keep the room). */}
            <LightNode state={session.state} />
            <span className="sr-only">{light.label}</span>
          </span>
        </StatusColumn>
      </span>
    </Tooltip>
  );
}
