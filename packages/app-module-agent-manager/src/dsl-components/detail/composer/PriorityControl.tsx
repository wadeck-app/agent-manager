import { Clock, Zap } from 'lucide-react';
import { TabButton } from '@wadeck-app/dsl-ui';
import { Tooltip } from '../deps.js';

/** What the "Interrupt now" chip says to hover and to focus: what is lost, that sending is immediate, and that the mode is armed for one message only. */
export const INTERRUPT_WARNING = "Interrupting aborts the tool call the agent is running right now: work in that call is lost. The message is sent as soon as you press Send or Enter, with no further question. This mode is for one message only: after the send it goes back to 'After current step'.";

/**
 * Choice of when the agent reads the message. "After current step" is the default and safe one. "Interrupt now" is visually apart (a gap and a
 * warning colour when armed) because it aborts the tool call the agent is running. There is no second confirmation: choosing the mode IS the confirmation, the
 * warning is in the tooltip of the chip (hover and keyboard focus), and the mode is armed for ONE message (the composer goes back to "After current step" after a send).
 */
export function PriorityControl({ priority, onChange, disabled }: { priority: 'next' | 'now'; onChange: (priority: 'next' | 'now') => void; disabled: boolean }) {
  return (
    <div role="group" aria-label="When the agent reads the message" className="flex items-center gap-3">
      <Tooltip content="The agent reads the message after its current tool call finishes. Nothing is interrupted.">
        <TabButton size="sm" active={priority === 'next'} aria-pressed={priority === 'next'} disabled={disabled} onClick={() => onChange('next')}>
          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
          After current step
        </TabButton>
      </Tooltip>
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <Tooltip content={INTERRUPT_WARNING}>
        {/* Armed, the base danger outline says it: the only warning-like state of the toggle. */}
        <TabButton size="sm" variant={priority === 'now' ? 'danger-outline' : 'ghost'} active={priority === 'now'} aria-pressed={priority === 'now'} disabled={disabled} onClick={() => onChange(priority === 'now' ? 'next' : 'now')}>
          <Zap aria-hidden="true" className="h-3.5 w-3.5" />
          Interrupt now
        </TabButton>
      </Tooltip>
    </div>
  );
}

/** The second confirmation of an interrupting send: says what is lost and asks for an explicit click. */
