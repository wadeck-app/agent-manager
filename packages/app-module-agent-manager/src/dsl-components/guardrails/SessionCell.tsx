import { Tooltip } from '@wadeck-app/dsl-ui';
import { PAGE_BASE } from '../data/http.js';
import { PageLink } from '../ui/PageLink.js';

/** A session of the plugin's files: its name and a link to the Agents page when the registry knows it, else the id (full when known, else the 8 characters). */
export function SessionCell({ sessionId, name }: { sessionId: string; name: string }) {
  const shortId = sessionId.slice(0, 8);
  if (name === '') {
    return (
      <Tooltip content={`${sessionId}: not in the session registry (ended or never listed)`}>
        <span className="font-mono text-am-mono">{sessionId.length > 8 ? shortId : sessionId}</span>
      </Tooltip>
    );
  }
  return (
    <span className="flex flex-col">
      <Tooltip content={`Open ${name} in the Agents page`}>
        <PageLink to={`${PAGE_BASE}/agents?session=${encodeURIComponent(sessionId)}`} label={name} />
      </Tooltip>
      <Tooltip content={sessionId}>
        <span className="font-mono text-xs text-muted">{shortId}</span>
      </Tooltip>
    </span>
  );
}
