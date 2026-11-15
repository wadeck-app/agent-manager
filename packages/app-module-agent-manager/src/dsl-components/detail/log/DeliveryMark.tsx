import { Check, CheckCheck, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { DeliveryUi } from '../deps.js';
import { Tooltip } from '../deps.js';

const LOOK: Record<DeliveryUi | 'unconfirmed', { icon: LucideIcon; label: string; text: string; spin: string }> = {
  sending: { icon: LoaderCircle, label: 'Sending', text: 'text-muted', spin: 'animate-spin motion-reduce:animate-none' },
  delivered: { icon: Check, label: 'Delivered', text: 'text-hue-green', spin: '' },
  seen: { icon: CheckCheck, label: 'Seen by the agent', text: 'text-hue-green', spin: '' },
  failed: { icon: TriangleAlert, label: 'Problem', text: 'text-hue-red', spin: '' },
  unconfirmed: { icon: TriangleAlert, label: 'Not confirmed', text: 'text-warning-text', spin: '' },
};

export type MarkState = DeliveryUi | 'unconfirmed';

export interface DeliveryMarkProps {
  state: MarkState;
  /** Why the state was reached (the server's reason, or what the page knows). */
  reason?: string;
  /** What to do about it. */
  hint?: string;
}

/** The delivery of a sent message as one small icon (single check: delivered, double: seen, warning: a problem, spinner: sending), the words in its tooltip. */
export function DeliveryMark({ state, reason = '', hint = '' }: DeliveryMarkProps) {
  const look = LOOK[state];
  const Icon = look.icon;
  const words = [look.label, [reason, hint].filter((part) => part !== '').join('. ')].filter((part) => part !== '').join(': ');
  return (
    <Tooltip content={words}>
      <span role="img" aria-label={words} tabIndex={0} className={`inline-flex shrink-0 items-center rounded ${look.text}`}>
        <Icon aria-hidden="true" className={`h-am-icon-sm w-am-icon-sm ${look.spin}`} />
      </span>
    </Tooltip>
  );
}
