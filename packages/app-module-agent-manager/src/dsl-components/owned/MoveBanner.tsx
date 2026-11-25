import { CircleCheck, TriangleAlert } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { switchViewOf } from '../logic/adoptSwitch.js';

/**
 * The look C of the A/B question ui-switch-readiness: a full-width coloured row under the header that says in a sentence what moving the session does. Green
 * when nothing runs, amber when something would be interrupted or when what runs cannot be known. Nothing for a session that cannot move (the line says why).
 */
export function MoveBanner({ session }: { session: AgentRow }) {
  const view = switchViewOf(session);
  if (view === undefined || view.recovery === true) {
    return null;
  }
  const free = view.readiness === 'free';
  const text = free
    ? 'Nothing runs: moving keeps the whole conversation.'
    : view.readiness === 'busy'
      ? `Moving interrupts ${view.reasons.length} running item${view.reasons.length === 1 ? '' : 's'}: ${view.reasons[0] ?? ''}`
      : `agent-manager cannot tell what runs: ${view.reasons[0] ?? ''}`;
  const Icon = free ? CircleCheck : TriangleAlert;
  return (
    <p data-adopt-banner={view.readiness} className={`flex w-full items-start gap-1.5 rounded border px-2 py-1 text-xs ${free ? 'border-hue-green/30 bg-hue-green-bg text-hue-green' : 'border-warning bg-warning-bg text-warning-text'}`}>
      <Icon aria-hidden="true" className="mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0" />
      <span>{text}</span>
    </p>
  );
}
