/**
 * The PIN class of every write route (app-core "sensitive routes": the host answers 401 elevation-required or 403 pin-not-set without an access token).
 * A route is "METHOD /path" as registered. The CSRF guard (T-08) stays on every non-GET route whatever its class.
 *
 * | Route                                   | Class         | Why                                              |
 * |-----------------------------------------|---------------|--------------------------------------------------|
 * | POST /owned/launch                      | sensitive     | starts an agent process                          |
 * | POST /owned/:id/resume                  | sensitive     | starts an agent process                          |
 * | POST /owned/:id/stop                    | sensitive     | kills a running session                          |
 * | POST /owned/:id/interrupt               | sensitive     | cancels the running turn                         |
 * | POST /owned/:id/permission-mode         | sensitive     | widens or narrows what the agent may do alone    |
 * | POST /owned/:id/permissions/:requestId  | sensitive     | allows or denies a tool call                     |
 * | POST /sessions/:sessionId/reply         | sensitive     | sends a message to an agent                      |
 * | POST /sessions/:sessionId/pin           | not sensitive | module-local preference                          |
 * | POST /sessions/:sessionId/seen          | not sensitive | module-local marker                              |
 * | POST /owned/:id/forget                  | not sensitive | removes a record, touches no process             |
 * | PUT /sessions/:sessionId/reply/transport | not sensitive | preference; the message itself is gated          |
 * | PUT /reply/transport/default            | not sensitive | preference; the message itself is gated          |
 *
 * backend/routeClasses.test.ts fails when a non-GET route is in neither list, so a new write route must be classified here.
 */
export const SENSITIVE_ROUTES: readonly string[] = [
  'POST /owned/launch',
  'POST /owned/:id/resume',
  'POST /owned/:id/stop',
  'POST /owned/:id/interrupt',
  'POST /owned/:id/permission-mode',
  'POST /owned/:id/permissions/:requestId',
  'POST /sessions/:sessionId/reply',
];

export const NOT_SENSITIVE_ROUTES: readonly string[] = [
  'POST /sessions/:sessionId/pin',
  'POST /sessions/:sessionId/seen',
  'POST /owned/:id/forget',
  'PUT /sessions/:sessionId/reply/transport',
  'PUT /reply/transport/default',
];

/** True when the request ("POST", "/owned/abc/stop", path without query) is one of SENSITIVE_ROUTES: the UI sends it through the app-core shell fetcher (PIN dialog). */
export function isSensitiveRequest(method: string, path: string): boolean {
  const pathOnly = path.split('?')[0] ?? '';
  const segments = pathOnly.split('/').filter(Boolean);
  return SENSITIVE_ROUTES.some((route) => {
    const [routeMethod = '', routePath = ''] = route.split(' ');
    const wanted = routePath.split('/').filter(Boolean);
    return routeMethod === method.toUpperCase() && wanted.length === segments.length && wanted.every((part, i) => part.startsWith(':') || part === segments[i]);
  });
}
