import { subagentLabel } from './subagentTree.js';
import { CircleCheck, GitFork, LoaderCircle } from 'lucide-react';
import type { SubagentDto } from '../deps.js';
import { FOCUS_RING } from '../deps.js';
import { Tooltip } from '../deps.js';
import { LOG_ICON, LOG_ICON_SM, LOG_META } from './sizes.js';

export function SubagentNode({ node, selected, onSelect, depth }: { node: SubagentDto; selected: string | undefined; onSelect: (agentId: string) => void; depth: number }) {
  const Icon = node.finished ? CircleCheck : LoaderCircle;
  const state = node.finished ? 'Finished' : 'Running (it has not marked itself finished)';
  const details = [node.agentType, node.model, node.isFork ? 'fork' : undefined, node.description !== undefined && node.name !== undefined ? node.description : undefined].filter(Boolean).join(', ');
  return (
    <li>
      <Tooltip content={`${state}${details === '' ? '' : `. ${details}`}. Click to highlight its call in the log (its own log is not served).`}>
        <button
          type="button"
          aria-pressed={selected === node.agentId}
          onClick={() => onSelect(node.agentId)}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 ${LOG_META} ${selected === node.agentId ? 'border-primary bg-primary-light text-content' : 'border-border bg-surface text-content hover:bg-muted-bg'} ${FOCUS_RING}`}
        >
          <Icon aria-hidden="true" className={`${LOG_ICON_SM} ${node.finished ? 'text-hue-green' : 'animate-spin text-hue-yellow motion-reduce:animate-none'}`} />
          {node.isFork ? <GitFork aria-hidden="true" className={`${LOG_ICON_SM} text-muted`} /> : null}
          <span className="truncate">{subagentLabel(node)}</span>
          {node.children.length > 0 ? <span className="text-muted">{node.children.length} sub</span> : null}
          <span className="sr-only">{state}</span>
        </button>
      </Tooltip>
      {node.children.length > 0 ? (
        <ul className={`mt-1 flex flex-col gap-1 border-l border-border pl-3 ${depth > 3 ? '' : 'ml-2'}`}>
          {node.children.map((child) => (
            <SubagentNode key={child.agentId} node={child} selected={selected} onSelect={onSelect} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
