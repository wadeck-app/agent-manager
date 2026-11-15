import { countStatuses } from './subagentModel.js';
import { SubagentsTitle } from './SubagentsTitle.js';
import { SubagentsView, type SubagentsViewProps } from './SubagentsView.js';

/** Layout `panel`: a column beside the log, always open. */
export function SubagentAside(props: SubagentsViewProps) {
  const counts = countStatuses(props.items);
  return (
    <aside aria-label="Sub-agents" className="flex min-h-0 w-am-aside shrink-0 flex-col border-l border-border">
      <h3 className="flex shrink-0 items-center border-b border-border px-3 py-2">
        <SubagentsTitle counts={counts} />
      </h3>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <SubagentsView {...props} />
      </div>
    </aside>
  );
}
