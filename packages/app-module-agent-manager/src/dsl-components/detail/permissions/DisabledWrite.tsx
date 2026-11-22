import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { Plus, Trash2 } from 'lucide-react';
import { GUARDRAILS_WRITE_ENABLED, GUARDRAILS_WRITE_NEEDS, Tooltip } from '../deps.js';

/** A write control that cannot work yet: drawn, disabled, with the reason as its tooltip (a disabled button gets no hover, so the tooltip wraps it). */
export function DisabledWrite({ label, icon, iconOnly = false }: { label: string; icon: 'add' | 'revoke'; iconOnly?: boolean }) {
  const Icon = icon === 'add' ? Plus : Trash2;
  return (
    <Tooltip content={GUARDRAILS_WRITE_NEEDS}>
      <span data-write-control={icon} title={GUARDRAILS_WRITE_NEEDS} className="inline-flex">
        {iconOnly ? (
          <IconButton size="icon-xs" aria-label={label} disabled={!GUARDRAILS_WRITE_ENABLED} icon={<Icon aria-hidden="true" className="h-3 w-3" />} />
        ) : (
          <ButtonAction variant="secondary" size="sm" disabled={!GUARDRAILS_WRITE_ENABLED} icon={<Icon aria-hidden="true" className="h-3.5 w-3.5" />} label={label} />
        )}
      </span>
    </Tooltip>
  );
}

