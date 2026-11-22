import { ButtonAction } from '@wadeck-app/dsl-ui';
import { Plus } from 'lucide-react';
import { GUARDRAILS_WRITE_ENABLED, GUARDRAILS_WRITE_NEEDS, Tooltip } from '../deps.js';

/** The Add control, which cannot work yet: drawn, disabled, with the reason as its tooltip (a disabled button gets no hover, so the tooltip wraps it). */
export function DisabledWrite({ label }: { label: string }) {
  return (
    <Tooltip content={GUARDRAILS_WRITE_NEEDS}>
      <span data-write-control="add" title={GUARDRAILS_WRITE_NEEDS} className="inline-flex">
        <ButtonAction variant="secondary" size="sm" disabled={!GUARDRAILS_WRITE_ENABLED} icon={<Plus aria-hidden="true" className="h-3.5 w-3.5" />} label={label} />
      </span>
    </Tooltip>
  );
}
