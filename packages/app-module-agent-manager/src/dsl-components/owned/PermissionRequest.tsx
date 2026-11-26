import { ButtonAction, FieldText, Tooltip } from '@wadeck-app/dsl-ui';
import { Check, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import type { OwnedPermissionDto } from '../shared.js';
import { Chip } from '../ui/Chip.js';
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
    <div data-permission-request={request.requestId} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <ShieldAlert aria-hidden="true" className="h-am-icon w-am-icon shrink-0 text-hue-red" />
        <h3 className="text-sm font-semibold text-content">{`Permission request: ${title}`}</h3>
        {title !== request.toolName ? <span className="text-xs text-muted-tint">{request.toolName}</span> : null}
        {total > 1 ? <Chip variant="danger">{`1 of ${total}`}</Chip> : null}
      </div>
      {request.description !== undefined && request.description !== '' ? <Tooltip content={request.description} describe={false}>
          <p data-tip-fit="" className="line-clamp-2 text-sm text-content">{request.description}</p>
        </Tooltip> : null}
      {request.blockedPath !== undefined && request.blockedPath !== '' ? (
        <p className="text-sm text-muted-tint">
          Path outside the allowed folders: <span className="break-all font-mono text-am-mono text-content">{request.blockedPath}</span>
        </p>
      ) : null}
      {blocks.map((block) => (
        <PermissionInput key={block.label} label={block.label} text={block.text} />
      ))}
      {/* Narrow: the buttons on one row, the reason full width under them (column-reverse of the DOM order). From sm: one row, the reason beside the buttons. */}
      <div data-permission-actions="" className="flex flex-col-reverse gap-1.5 sm:flex-row sm:items-end sm:gap-2">
        {/* The label stays for screen readers (the accessible name); the sighted user reads the same words as the placeholder, which saves a line. */}
        <div data-permission-reason="" className="w-full min-w-0 sm:flex-1 [&_label]:sr-only [&_input]:mt-0">
          <FieldText label="Reason for the agent if you deny (optional)" placeholder="Reason for the agent if you deny (optional)" value={reason} onChange={setReason} disabled={inFlight} autoComplete="off" />
        </div>
        <div data-permission-buttons="" className="flex flex-nowrap items-center justify-end gap-2">
          <ButtonAction variant="danger-outline" disabled={inFlight} onClick={() => onDecide(request, 'deny', reason)} icon={<X aria-hidden="true" className="h-4 w-4" />} label="Deny" />
          <ButtonAction variant="primary" loading={inFlight} onClick={() => onDecide(request, 'allow', '')} icon={<Check aria-hidden="true" className="h-4 w-4" />} label="Allow once" />
        </div>
      </div>
    </div>
  );
}
