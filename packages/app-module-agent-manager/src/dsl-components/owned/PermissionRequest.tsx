import { Check, LoaderCircle, ShieldAlert, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { OwnedPermissionDto } from '../shared.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import { PermissionInput } from './PermissionInput.js';
import { inputBlocks } from './permissionBlocks.js';

export interface PermissionRequestProps {
  request: OwnedPermissionDto;
  total: number;
  inFlight: boolean;
  onDecide: (request: OwnedPermissionDto, decision: 'allow' | 'deny', message: string) => void;
}

/** The request the user answers now: what the tool is, what it will do, and two buttons. The deny reason is optional and read by the agent. */
export function PermissionRequest({ request, total, inFlight, onDecide }: PermissionRequestProps) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const title = request.displayName ?? request.toolName;
  const blocks = inputBlocks(request.input);
  return (
    <div data-permission-request={request.requestId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ShieldAlert aria-hidden="true" className="h-am-icon w-am-icon shrink-0 text-hue-red" />
        <h3 className="text-base font-semibold text-content">{`Permission request: ${title}`}</h3>
        {title !== request.toolName ? <span className="text-xs text-muted">{request.toolName}</span> : null}
        {total > 1 ? <span className="rounded-full bg-surface px-2 text-xs text-hue-red">{`1 of ${total}`}</span> : null}
      </div>
      {request.description !== undefined && request.description !== '' ? <p className="text-sm text-content">{request.description}</p> : null}
      {request.blockedPath !== undefined && request.blockedPath !== '' ? (
        <p className="text-sm text-muted">
          Path outside the allowed folders: <span className="break-all font-mono text-am-mono text-content">{request.blockedPath}</span>
        </p>
      ) : null}
      {blocks.map((block) => (
        <PermissionInput key={block.label} label={block.label} text={block.text} />
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <label htmlFor={reasonId} className="text-xs text-muted">
            Reason for the agent if you deny (optional)
          </label>
          <input id={reasonId} type="text" value={reason} disabled={inFlight} onChange={(event) => setReason(event.target.value)} autoComplete="off" className={`w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-content disabled:opacity-60 ${FOCUS_RING}`} />
        </div>
        <button
          type="button"
          disabled={inFlight}
          onClick={() => onDecide(request, 'deny', reason)}
          className={`inline-flex h-am-hit items-center gap-1.5 rounded border border-danger bg-danger-bg px-3 text-sm font-medium text-danger-text disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
        >
          <X aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          Deny
        </button>
        <button
          type="button"
          disabled={inFlight}
          onClick={() => onDecide(request, 'allow', '')}
          className={`inline-flex h-am-hit items-center gap-1.5 rounded border border-primary bg-primary-light px-3 text-sm font-medium text-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
        >
          {inFlight ? <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm animate-spin motion-reduce:animate-none" /> : <Check aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />}
          Allow once
        </button>
      </div>
    </div>
  );
}
