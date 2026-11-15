import { Bot, CircleCheck, CircleDot } from 'lucide-react';
import type { SubagentDto } from '../shared.js';

const INDENT = ['pl-14', 'pl-20', 'pl-24'] as const;

export function SubagentRowNode({ node, depth }: { node: SubagentDto; depth: number }) {
  const label = node.name ?? node.description ?? node.agentType ?? node.agentId;
  const Icon = node.finished ? CircleCheck : CircleDot;
  return (
    <>
      <div role="treeitem" aria-level={depth + 3} aria-selected={false} className={`flex items-center gap-1.5 py-1 pr-3 text-xs ${INDENT[Math.min(depth, INDENT.length - 1)]}`}>
        <Bot aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-content" title={node.description ?? label}>
          {label}
        </span>
        {node.agentType !== undefined && node.agentType !== label ? <span className="shrink-0 text-muted">{node.agentType}</span> : null}
        <Icon role="img" aria-label={node.finished ? 'Finished' : 'Not marked finished'} className={`h-am-icon-sm w-am-icon-sm shrink-0 ${node.finished ? 'text-hue-green' : 'text-muted'}`} />
      </div>
      {node.children.map((child) => (
        <SubagentRowNode key={child.agentId} node={child} depth={depth + 1} />
      ))}
    </>
  );
}
