import { SubagentGroup } from './SubagentGroup.js';
import { groupByType } from './subagentModel.js';
import type { SubagentContentProps } from './subagentTypes.js';

/** Content (b): the sub-agents grouped by agent type, each group with its count, a status bar and what is running or failed in it; groups with something to look at start open. */
export function SubagentGroups({ items, all: _all, ...rest }: SubagentContentProps) {
  const groups = groupByType(items);
  return (
    <ul className="flex flex-col gap-1.5 px-2 pb-2">
      {groups.map((group) => (
        <SubagentGroup key={group.type} group={group} {...rest} />
      ))}
      {groups.length === 0 ? <li className="px-1 py-2 text-xs text-muted">No sub-agent with this status.</li> : null}
    </ul>
  );
}
