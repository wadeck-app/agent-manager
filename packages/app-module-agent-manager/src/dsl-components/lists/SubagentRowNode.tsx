import { Tooltip } from '@wadeck-app/dsl-ui';
import { Bot, CircleCheck, CircleDot } from 'lucide-react';
import type { SubagentDto } from '../shared.js';
import { StatusColumn } from '../ui/StatusColumn.js';
import { InlineSecondary } from './RowSecondary.js';
import { TIP_FILL } from '../ui/tipWrap.js';

const INDENT = ['pl-14', 'pl-20', 'pl-24'] as const;

export function SubagentRowNode({ node, depth }: { node: SubagentDto; depth: number }) {
  const label = node.name ?? node.description ?? node.agentType ?? node.agentId;
  const Icon = node.finished ? CircleCheck : CircleDot;
  // The agent type is the secondary text of the row.
  const type = node.agentType !== undefined && node.agentType !== label ? node.agentType : undefined;
  return (
    <>
      <div role="treeitem" aria-level={depth + 3} aria-selected={false} className={`flex items-center gap-1.5 py-1 pr-2.5 text-xs ${INDENT[Math.min(depth, INDENT.length - 1)]}`}>
        <Bot aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
        <Tooltip className={TIP_FILL} content={node.description ?? label} describe={false}>
          <span data-tip-fill="" className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 truncate text-content">{label}</span>
            {type === undefined ? null : <InlineSecondary textClass="">{type}</InlineSecondary>}
          </span>
        </Tooltip>
        {/* The finished mark is in the same 28 px column as the state lights of the rows above: one vertical axis. */}
        <StatusColumn>
          <Icon role="img" aria-label={node.finished ? 'Finished' : 'Not marked finished'} className={`h-3.5 w-3.5 shrink-0 ${node.finished ? 'text-hue-green' : 'text-muted'}`} />
        </StatusColumn>
      </div>
      {node.children.map((child) => (
        <SubagentRowNode key={child.agentId} node={child} depth={depth + 1} />
      ))}
    </>
  );
}
