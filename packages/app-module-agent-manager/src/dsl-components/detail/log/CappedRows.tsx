import { MoreButtons } from './MoreButtons.js';
import { SubagentRow } from './SubagentRow.js';
import { PAGE_SIZE, type SubagentItem } from './subagentModel.js';
import type { SubagentContentProps } from './subagentTypes.js';
import { useCapped } from './useCapped.js';

export type CappedRowsProps = Omit<SubagentContentProps, 'items' | 'all'> & { items: SubagentItem[] };

/** Rows of the sub-agents, a page at a time, with "Show more" / "Show all" for the rest. */
export function CappedRows({ items, now, selectedId, locate, onSelect }: CappedRowsProps) {
  const capped = useCapped(items);
  return (
    <>
      {capped.shown.map((item) => (
        <SubagentRow key={item.dto.agentId} item={item} now={now} selected={selectedId === item.dto.agentId} locate={locate} onSelect={onSelect} />
      ))}
      <MoreButtons hidden={capped.hidden} step={PAGE_SIZE} onMore={capped.more} onAll={capped.all} />
    </>
  );
}
