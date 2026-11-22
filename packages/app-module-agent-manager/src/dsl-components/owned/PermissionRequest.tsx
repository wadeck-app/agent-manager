import { ButtonAction, FieldText } from '@wadeck-app/dsl-ui';
import { Check, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import type { OwnedPermissionDto } from '../shared.js';
import { FOCUS_RING } from '../ui/focusRing.js';
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
        <div className="min-w-0 flex-1">
          <FieldText label="Reason for the agent if you deny (optional)" value={reason} onChange={setReason} disabled={inFlight} autoComplete="off" />
        </div>
        <ButtonAction variant="danger-outline" disabled={inFlight} onClick={() => onDecide(request, 'deny', reason)} icon={<X aria-hidden="true" className="h-4 w-4" />} label="Deny" />
        <ButtonAction variant="primary" loading={inFlight} onClick={() => onDecide(request, 'allow', '')} icon={<Check aria-hidden="true" className="h-4 w-4" />} label="Allow once" />
      </div>
    </div>
  );
}
