import { Clock, Zap } from 'lucide-react';
import { Tooltip } from '../deps.js';

/** When the agent reads the message: "After current step" (clock) or "Interrupt now" (orange lightning: it aborted the running tool call). */
export function PriorityMark({ priority }: { priority: 'next' | 'now' }) {
  const interrupt = priority === 'now';
  const Icon = interrupt ? Zap : Clock;
  const words = interrupt ? 'Interrupt now: this message aborted the tool call the agent was running' : 'After current step: the agent read it when its current tool call finished';
  return (
    <Tooltip content={words}>
      <span role="img" aria-label={interrupt ? 'Interrupt now' : 'After current step'} tabIndex={0} className={`inline-flex shrink-0 items-center rounded ${interrupt ? 'text-warning-text' : 'text-muted'}`}>
        <Icon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
      </span>
    </Tooltip>
  );
}
