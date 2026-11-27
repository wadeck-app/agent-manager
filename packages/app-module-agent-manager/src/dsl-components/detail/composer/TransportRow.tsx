import { ButtonAction } from '@wadeck-app/dsl-ui';
import { ChevronDown, ChevronRight, CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { RowButton, FOCUS_RING } from '../deps.js';
import type { TransportStatusDto } from '../deps.js';
import { CopyButton } from '../log/CopyButton.js';
import { firstCommand, shortText } from './transportText.js';

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

const BADGE = 'rounded-full px-1.5 text-[11px] leading-5';
const ICON = 'h-am-icon-sm w-am-icon-sm shrink-0';

export interface TransportRowProps {
  transport: TransportStatusDto;
  busy: boolean;
  onSession: (transportId: string) => void;
  onDefault: (transportId: string) => void;
}

/**
 * One transport of the popover, compact: a status icon, its name, short badges (In use, Default, This session) and the two actions on the first line; one
 * short line under it (how it delivers when it works, the cause and the single fix when it does not). The whole reason, the fix sentence and the warning of a
 * typed delivery are behind "Details". An unavailable row is muted and has no actions: the fix is the only thing to do.
 */
export function TransportRow({ transport, busy, onSession, onDefault }: TransportRowProps) {
  const { transportId, available, selected, isDefault, sessionOverride, deliveredAs } = transport;
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const probing = transport.probed === false;
  const command = firstCommand(transport.fix);
  const muted = !probing && !available;
  return (
    <li data-transport={transportId} data-available={probing ? 'checking' : String(available)} className={`flex flex-col gap-0.5 rounded border px-2 py-1.5 ${selected ? 'border-primary bg-primary-light' : 'border-border'} ${muted ? 'bg-muted-bg/40' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {probing ? (
          <LoaderCircle aria-label="Checking" className={`${ICON} animate-spin text-muted motion-reduce:animate-none`} />
        ) : available ? (
          <CircleCheck aria-label="Available" className={`${ICON} text-hue-green`} />
        ) : (
          <TriangleAlert aria-label="Not available" className={`${ICON} text-warning-text`} />
        )}
        <span className={`text-sm font-medium ${muted ? 'text-muted' : 'text-content'}`}>{transportId}</span>
        {selected ? <span className={`${BADGE} bg-surface text-content`}>In use</span> : null}
        {isDefault ? <span className={`${BADGE} border border-border text-muted`}>Default</span> : null}
        {sessionOverride ? <span className={`${BADGE} border border-border text-muted`}>This session</span> : null}
        {available && !probing ? (
          <span role="group" aria-label={`Use ${transportId}`} className="ml-auto flex gap-1">
            <ButtonAction variant="secondary" size="sm" disabled={busy || sessionOverride} onClick={() => onSession(transportId)} label="Use here" />
            <ButtonAction variant="secondary" size="sm" disabled={busy || isDefault} onClick={() => onDefault(transportId)} label="Make default" />
          </span>
        ) : null}
      </div>
      <p className={`pl-5 text-xs ${muted ? 'text-warning-text' : 'text-muted'}`}>
        {probing ? 'Checking...' : available ? `Ready, ${deliveredAs === 'typed' ? 'typed as you' : 'peer message'}` : shortText(transport.reason)}
      </p>
      {muted && transport.fix !== '' ? (
        <p className="flex items-center gap-1 pl-5 text-xs text-muted">
          {command !== undefined ? (
            <>
              <code className="truncate rounded bg-muted-bg px-1 font-mono text-am-mono text-content">{command}</code>
              <CopyButton text={command} label={`Copy the command to fix ${transportId}`} />
            </>
          ) : (
            <span>{shortText(transport.fix)}</span>
          )}
        </p>
      ) : null}
      <RowButton type="button" aria-expanded={open} aria-controls={open ? detailsId : undefined} onClick={() => setOpen(!open)} className={`ml-5 inline-flex items-center gap-0.5 self-start rounded text-xs text-muted hover:text-content ${FOCUS_RING}`}>
        {open ? <ChevronDown aria-hidden="true" className={ICON} /> : <ChevronRight aria-hidden="true" className={ICON} />}
        Details
      </RowButton>
      {open ? (
        <dl id={detailsId} className="ml-5 flex flex-col gap-1 text-xs text-muted">
          <div>
            <dt className="font-medium text-content">Delivery</dt>
            <dd>{DELIVERED_AS_LINE[deliveredAs]}</dd>
            {deliveredAs === 'typed' ? <dd>{typedWarning(transportId)}</dd> : null}
          </div>
          {probing ? null : (
            <div>
              <dt className="font-medium text-content">{available ? 'Available' : 'Not available'}</dt>
              <dd>{transport.reason}</dd>
            </div>
          )}
          {muted && transport.fix !== '' ? (
            <div>
              <dt className="font-medium text-content">Fix</dt>
              <dd>{transport.fix}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </li>
  );
}
