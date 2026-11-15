import { Check, CheckCheck, CircleAlert, LoaderCircle, type LucideIcon } from 'lucide-react';
import type { DeliveryUi } from '../deps.js';
import { Tooltip } from '../deps.js';

const LOOK: Record<DeliveryUi, { icon: LucideIcon; label: string; text: string; spin: string }> = {
  sending: { icon: LoaderCircle, label: 'Sending', text: 'text-muted', spin: 'animate-spin motion-reduce:animate-none' },
  delivered: { icon: Check, label: 'Delivered', text: 'text-hue-blue', spin: '' },
  seen: { icon: CheckCheck, label: 'Seen by agent', text: 'text-hue-green', spin: '' },
  failed: { icon: CircleAlert, label: 'Failed', text: 'text-danger-text', spin: '' },
};

/** The delivery state as an icon with a text label (the colour is never the only signal). */
export function DeliveryBadge({ ui, reason }: { ui: DeliveryUi; reason?: string }) {
  const look = LOOK[ui];
  const Icon = look.icon;
  return (
    <Tooltip content={reason !== undefined && reason !== '' ? `${look.label}: ${reason}` : look.label}>
      <span className={`inline-flex shrink-0 items-center gap-1 text-xs ${look.text}`}>
        <Icon aria-hidden="true" className={`h-am-icon-sm w-am-icon-sm ${look.spin}`} />
        {look.label}
      </span>
    </Tooltip>
  );
}

/** A collapsible list of the last messages sent to the session with their delivery state. Hidden entirely when there is nothing to list. */
