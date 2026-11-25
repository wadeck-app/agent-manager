import type { AgentRow } from '../data/types.js';
import { herdrLight } from '../logic/herdrRow.js';
import { STATE_MEANING } from '../logic/states.js';
import { StatusColumn } from '../ui/StatusColumn.js';
import { Tooltip } from '../ui/Tooltip.js';
import { LightNode } from './LightNode.js';

/**
 * The state light on the right of a Herdr row, in the fixed 28 px column of the page (ui/StatusColumn.tsx): every light is centred in the column, so the
 * lights of all the rows and the icons of the group headers sit on one vertical axis. The pill with words is wider than the column and right aligned.
 */
export function HerdrLightView({ session }: { session: AgentRow }) {
  const light = herdrLight(session.state);
  return (
    <Tooltip content={STATE_MEANING[session.state]} side="left">
      <span className="inline-flex shrink-0">
        <StatusColumn pill={light.kind === 'pill'}>
          <span data-herdr-light={light.kind} className="inline-flex items-center">
            <LightNode state={session.state} compact={false} />
            {light.kind === 'pill' ? null : <span className="sr-only">{light.label}</span>}
          </span>
        </StatusColumn>
      </span>
    </Tooltip>
  );
}
