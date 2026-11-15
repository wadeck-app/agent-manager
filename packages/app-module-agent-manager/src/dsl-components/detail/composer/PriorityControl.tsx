import { Clock, Zap } from 'lucide-react';
import { FOCUS_RING } from '../deps.js';
import { Tooltip } from '../deps.js';
import { PriorityConfirm } from './PriorityConfirm.js';

const BUTTON = `inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;

/**
 * Choice of when the agent reads the message. "After current step" is the default and safe one. "Interrupt now" is visually apart (a gap and a
 * warning colour when armed) because it aborts the tool call the agent is running; sending it asks for a second confirmation (PriorityConfirm).
 */
export function PriorityControl({ priority, onChange, disabled }: { priority: 'next' | 'now'; onChange: (priority: 'next' | 'now') => void; disabled: boolean }) {
  return (
    <div role="group" aria-label="When the agent reads the message" className="flex items-center gap-3">
      <Tooltip content="The agent reads the message after its current tool call finishes. Nothing is interrupted.">
        <button type="button" aria-pressed={priority === 'next'} disabled={disabled} onClick={() => onChange('next')} className={`${BUTTON} ${priority === 'next' ? 'bg-muted-bg text-content' : 'text-muted hover:text-content'}`}>
          <Clock aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          After current step
        </button>
      </Tooltip>
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <Tooltip content="Aborts the tool call the agent is running and delivers the message now. Asks for a confirmation before sending.">
        <button type="button" aria-pressed={priority === 'now'} disabled={disabled} onClick={() => onChange(priority === 'now' ? 'next' : 'now')} className={`${BUTTON} ${priority === 'now' ? 'bg-warning-bg text-warning-text' : 'text-muted hover:text-content'}`}>
          <Zap aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          Interrupt now
        </button>
      </Tooltip>
    </div>
  );
}

/** The second confirmation of an interrupting send: says what is lost and asks for an explicit click. */
