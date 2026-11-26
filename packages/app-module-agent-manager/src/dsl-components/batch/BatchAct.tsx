import { IconButton, Tooltip } from '@wadeck-app/dsl-ui';
import type { ReactNode } from 'react';

/** An icon button with its name as tooltip; `off` is the reason it cannot be used (a disabled button gets no hover, so the tooltip wraps it). */
export function BatchAct({ label, icon, onClick, off }: { label: string; icon: ReactNode; onClick?: () => void; off?: string }) {
  return (
    <Tooltip content={off ?? label}>
      <span className="inline-flex">
        <IconButton size="icon-sm" aria-label={label} disabled={off !== undefined} {...(onClick === undefined ? {} : { onClick })} icon={icon} />
      </span>
    </Tooltip>
  );
}

