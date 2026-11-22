import { SubagentRowNode } from './SubagentRowNode.js';
import { ButtonAction } from '@wadeck-app/dsl-ui';
import { RefreshCw } from 'lucide-react';
import { useSubagents } from '../data/useSubagents.js';

/** The sub-agents of an expanded session, loaded when the row opens. Their logs are not served: they are listed, not selectable. */
export function SubagentRows({ sessionId }: { sessionId: string }) {
  const { state, retry } = useSubagents(sessionId, true);
  if (state.status === 'loading') {
    return (
      <p role="status" className="py-1 pl-14 pr-3 text-xs text-muted">
        Loading the sub-agents
      </p>
    );
  }
  if (state.status === 'failed') {
    return (
      <div role="alert" className="flex items-start gap-2 py-1 pl-14 pr-3 text-xs text-danger-text">
        <span className="min-w-0 flex-1">{state.text}</span>
<ButtonAction variant="secondary" size="sm" icon={<RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />} label="Retry" onClick={retry} />
      </div>
    );
  }
  return (
    <div role="group">
      {state.note !== '' ? <p className="py-1 pl-14 pr-3 text-xs text-warning-text">{state.note}</p> : null}
      {state.subagents.length === 0 && state.note === '' ? <p className="py-1 pl-14 pr-3 text-xs text-muted">No sub-agent files found for this session.</p> : null}
      {state.subagents.map((node) => (
        <SubagentRowNode key={node.agentId} node={node} depth={0} />
      ))}
    </div>
  );
}
