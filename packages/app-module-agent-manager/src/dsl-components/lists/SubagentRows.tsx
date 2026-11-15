import { SubagentRowNode } from './SubagentRowNode.js';
import { RefreshCw } from 'lucide-react';
import { useSubagents } from '../data/useSubagents.js';
import { FOCUS_RING } from '../ui/IconButton.js';

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
        <button type="button" onClick={retry} className={`inline-flex shrink-0 items-center gap-1 rounded border border-danger px-1.5 py-0.5 ${FOCUS_RING}`}>
          <RefreshCw aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          Retry
        </button>
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
