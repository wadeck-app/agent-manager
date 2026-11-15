import { STATUS_LOOK, type SubagentCounts } from './subagentModel.js';

/**
 * The count of each status as icon and number (the status icon is the label: shape and colour), for the header of the panel; `vertical` stacks them for the
 * collapsed rail, where each chip is one image with ONE name ("1 active"), also shown as a tooltip.
 */
export function CountChips({ counts, vertical = false }: { counts: SubagentCounts; vertical?: boolean }) {
  const parts = (['active', 'unknown', 'failed', 'idle'] as const).filter((status) => counts[status] > 0);
  return (
    <span className={`flex items-center text-xs tabular-nums ${vertical ? 'flex-col gap-1.5' : 'gap-2'}`}>
      {parts.map((status) => {
        const look = STATUS_LOOK[status];
        const Icon = look.icon;
        const name = `${counts[status]} ${look.label.toLowerCase()}`;
        return (
          <span key={status} role="img" aria-label={name} title={vertical ? name : undefined} className={`inline-flex items-center gap-1 ${vertical ? 'flex-col' : ''} ${look.text}`}>
            <Icon aria-hidden="true" className={`h-am-icon-sm w-am-icon-sm ${look.iconClass}`} />
            <span aria-hidden="true">{counts[status]}</span>
          </span>
        );
      })}
    </span>
  );
}
