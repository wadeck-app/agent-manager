import { ButtonAction } from '@wadeck-app/dsl-ui';
import { CircleCheck, Info, Keyboard, LoaderCircle, TriangleAlert, Users } from 'lucide-react';
import { FOCUS_RING, Tooltip } from '../deps.js';
import type { TransportStatusDto } from '../deps.js';

/** What the person who reads the popover learns about each way of delivering, in one line. */
export const DELIVERED_AS_LINE: Record<TransportStatusDto['deliveredAs'], string> = {
  typed: 'Typed prompt, as you',
  peer: 'Peer message wrapped by Claude Code',
};

/** The warning about a typed delivery lives in a tooltip only (never a permanent line). */
export const TYPED_WARNING = 'The text is typed into the terminal as if you had written it: the agent sees it as your own message, not as a message from another session. A dialog open in that terminal blocks it.';

/** The warning of a typed delivery, for the transport that does it: `owned` writes a prompt to the child, there is no terminal. */
export function typedWarning(transportId: string): string {
  return transportId === 'owned'
    ? 'The text is sent to the session as a prompt from you, with no wrapper: the agent sees it as your own message, not as a message from another session.'
    : TYPED_WARNING;
}


export interface TransportRowProps {
  transport: TransportStatusDto;
  busy: boolean;
  onSession: (transportId: string) => void;
  onDefault: (transportId: string) => void;
}

/** One transport of the popover: its name, how it delivers, whether it can deliver now (and why not), and the two ways to choose it. */
export function TransportRow({ transport, busy, onSession, onDefault }: TransportRowProps) {
  const { transportId, available, selected, isDefault, sessionOverride, deliveredAs } = transport;
  const DeliveryIcon = deliveredAs === 'typed' ? Keyboard : Users;
  return (
    <li data-transport={transportId} className={`flex flex-col gap-1 rounded border px-2.5 py-2 ${selected ? 'border-primary bg-primary-light' : 'border-border'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-content">{transportId}</span>
        {selected ? <span className="rounded-full bg-surface px-2 text-xs text-content">In use</span> : null}
        {isDefault ? <span className="rounded-full border border-border px-2 text-xs text-muted">Default</span> : null}
        {sessionOverride ? <span className="rounded-full border border-border px-2 text-xs text-muted">This session</span> : null}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <DeliveryIcon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
        <span>{DELIVERED_AS_LINE[deliveredAs]}</span>
        {deliveredAs === 'typed' ? (
          <Tooltip content={typedWarning(transportId)}>
            <button type="button" aria-label="About typed delivery" className={`inline-flex rounded text-muted hover:text-content ${FOCUS_RING}`}>
              <Info aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            </button>
          </Tooltip>
        ) : null}
      </p>
      {transport.probed === false ? (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 animate-spin motion-reduce:animate-none" />
          Checking whether it can deliver...
        </p>
      ) : (
        <p className={`flex items-start gap-1.5 text-xs ${available ? 'text-muted' : 'text-warning-text'}`}>
          {available ? <CircleCheck aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-hue-green" /> : <TriangleAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />}
          <span>
            {available ? 'Available' : 'Not available'}: {transport.reason}
            {!available && transport.fix !== '' ? `. ${transport.fix}` : ''}
          </span>
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <ButtonAction variant="secondary" size="sm" disabled={!available || busy || sessionOverride} onClick={() => onSession(transportId)} label="Use for this session" />
        <ButtonAction variant="secondary" size="sm" disabled={!available || busy || isDefault} onClick={() => onDefault(transportId)} label="Use as default" />
      </div>
    </li>
  );
}
