import { STATUS_LOOK, type SubagentCounts } from './subagentModel.js';

/** The count of each status as icon and number (the status icon is the label: shape and colour), for the header of a container. */
export function CountChips({ counts }: { counts: SubagentCounts }) {
  const parts = (['active', 'unknown', 'failed', 'idle'] as const).filter((status) => counts[status] > 0);
  return (
    <span className="flex items-center gap-2 text-xs tabular-nums">
      {parts.map((status) => {
        const look = STATUS_LOOK[status];
        const Icon = look.icon;
        return (
          <span key={status} className={`inline-flex items-center gap-1 ${look.text}`}>
            <Icon aria-hidden="true" className={`h-am-icon-sm w-am-icon-sm ${look.iconClass}`} />
            <span aria-label={`${counts[status]} ${look.label.toLowerCase()}`}>{counts[status]}</span>
          </span>
        );
      })}
    </span>
  );
}
