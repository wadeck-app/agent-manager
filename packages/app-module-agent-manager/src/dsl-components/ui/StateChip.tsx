import { Chip } from './Chip.js';
import { STATE_LOOK, STATE_VARIANT } from './stateLook.js';
import type { AgentState } from '../logic/states.js';

/**
 * The pill of a state, as the header of the Agents page draws it: icon and word, the colour of the state (never the only signal: the icon shape and the word
 * say it too). One look for every page that names a state, so the Table says "Working" and "Needs you", not another vocabulary.
 */
export function StateChip({ state }: { state: AgentState }) {
  const look = STATE_LOOK[state];
  const Icon = look.icon;
  return (
    <Chip data-state-chip={state} variant={STATE_VARIANT[state]} icon={<Icon className={`h-am-icon-sm w-am-icon-sm ${look.iconClass}`} />}>
      {look.label}
    </Chip>
  );
}
