import type { AgentRow } from '../data/types.js';
import { switchViewOf } from './adoptSwitch.js';
import type { ReadinessPreviewValue } from './uiVariants.js';

/*
 * The test helper of the A/B dock "Preview Move readiness" (dev dock only, see ui/UiVariants.tsx): it forces what the header of the open agent says about moving, so
 * that the three looks of the Move readiness can be seen on any agent, whatever state it really has. It never reaches a request: the preview Move button of a
 * synthetic agent sends nothing (SwitchAction `previewOnly`).
 */

const FORCED = {
  free: { state: 'free', reasons: [] },
  busy: { state: 'busy', reasons: ['A turn is running', 'Tool Bash is running'] },
  unknown: { state: 'unknown', reasons: ['Cannot tell whether something is running (preview: no transcript yet).'] },
} as const;

export interface ReadinessPreview {
  /** What the header line (and the Move button) show: the session with the forced readiness. */
  session: AgentRow;
  /** The agent cannot move by itself: the header draws a preview Move button for `session`, and the real controls keep the real session. */
  synthetic: boolean;
}

export function applyReadinessPreview(session: AgentRow, state: ReadinessPreviewValue): ReadinessPreview {
  if (state === 'real') {
    return { session, synthetic: false };
  }
  const readiness = FORCED[state];
  const forced: AgentRow = { ...session, adoptReadiness: { state: readiness.state, reasons: [...readiness.reasons] } };
  if (switchViewOf(forced) !== undefined) {
    return { session: forced, synthetic: false };
  }
  // A live Web session started here: the one shape that has a Move button in every look.
  return { session: { ...forced, alive: true, launchedBy: 'agent-manager', host: 'stream-json', ownedState: 'idle', switchFailure: undefined }, synthetic: true };
}
