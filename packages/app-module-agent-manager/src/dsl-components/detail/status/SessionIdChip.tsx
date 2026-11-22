import { Tooltip } from '../deps.js';
import { CopyButton } from '../log/CopyButton.js';

/** The session id (short, the full one in the tooltip and in the copy) with the name of the registry. */
export function SessionIdChip({ sessionId, name }: { sessionId: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <Tooltip content={`Session ${sessionId}, named "${name}" in the registry.`}>
        <span tabIndex={0} aria-label={`Session id ${sessionId}`} className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-am-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {sessionId.slice(0, 8)}
        </span>
      </Tooltip>
      <CopyButton text={sessionId} label="Copy the session id" />
    </span>
  );
}
