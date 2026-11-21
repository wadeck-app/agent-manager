/** A session of the plugin's files: its name and a link to the Agents page when the registry knows it, else the id (full when known, else the 8 characters). */
export function SessionCell({ sessionId, name }: { sessionId: string; name: string }) {
  const shortId = sessionId.slice(0, 8);
  if (name === '') {
    return (
      <span className="font-mono text-am-mono" title={`${sessionId}: not in the session registry (ended or never listed)`}>
        {sessionId.length > 8 ? shortId : sessionId}
      </span>
    );
  }
  return (
    <span className="flex flex-col">
      <a href={`/agents?session=${encodeURIComponent(sessionId)}`} className="text-primary underline" title={`Open ${name} in the Agents page`}>
        {name}
      </a>
      <span className="font-mono text-xs text-muted" title={sessionId}>
        {shortId}
      </span>
    </span>
  );
}
