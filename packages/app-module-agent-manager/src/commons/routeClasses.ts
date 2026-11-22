/**
 * The PIN class of every write route (app-core "sensitive routes": the host answers 401 elevation-required or 403 pin-not-set without an access token).
 * A route is "METHOD /path" as registered. The CSRF guard (T-08) stays on every non-GET route whatever its class.
 *
 * | Route                                   | Class         | Why                                              |
 * |-----------------------------------------|---------------|--------------------------------------------------|
 * | POST /owned/launch                      | sensitive     | starts an agent process                          |
 * | POST /owned/fork                        | sensitive     | starts an agent process on a copy of another session's history |
 * | POST /owned/:id/resume                  | sensitive     | starts an agent process                          |
 * | POST /owned/:id/switch                  | sensitive     | stops the process that hosts a session and starts it on another host (threat-model T-20) |
 * | POST /owned/:id/stop                    | sensitive     | kills a running session                          |
 * | POST /owned/:id/interrupt               | sensitive     | cancels the running turn                         |
 * | POST /owned/:id/forget                  | sensitive     | removes a record; for a bg session also runs `claude rm` on the supervisor (it can delete the worktree Claude Code made for it) |
 * | POST /owned/:id/permission-mode         | sensitive     | widens or narrows what the agent may do alone    |
 * | POST /owned/:id/permissions/:requestId  | sensitive     | allows or denies a tool call                     |
 * | POST /sessions/:sessionId/reply         | sensitive     | sends a message to an agent                      |
 * | POST /sessions/batch/reply              | sensitive     | sends ONE message to up to 20 agents: one PIN prompt for the batch, the same power as the single reply times N (threat-model T-21) |
 * | POST /sessions/:sessionId/hc-permission | sensitive     | types the answer of a permission dialog          |
 * | POST /sessions/:sessionId/pin           | not sensitive | module-local preference                          |
 * | POST /sessions/:sessionId/seen          | not sensitive | module-local marker                              |
 * | POST /groups, /groups/order, /groups/:id, /groups/:id/delete, POST /sessions/:sessionId/group, POST /sessions/:sessionId/marks | not sensitive | custom groups, flag and unread marks: module-local organization of the view |
 * | PUT /sessions/:sessionId/reply/transport | not sensitive | preference; the message itself is gated          |
 * | PUT /reply/transport/default            | not sensitive | preference; the message itself is gated          |
 * | GET /folders/roots, /list, /search, /recent | not sensitive (read) | names of folders inside the browsable roots only, see below |
 * | POST /guardrails/grants/:id/revoke      | sensitive     | removes a bypass of a session by running the plugin's own CLI (threat-model T-22) |
 * | POST /guardrails/sessions/:sessionId/grants | sensitive   | creates a bypass of a guardrail for a session by running the plugin's own CLI with the user's PIN token on its stdin (threat-model T-23) |
 * | GET /guardrails/sessions/:sessionId/rules | not sensitive | read-only categories of the guardrails of the session's folder (decision, source, bypassable), through the plugin's CLI |
 * | GET /guardrails/sessions/:sessionId/grants | not sensitive | read-only list of the bypasses of one session, through the plugin's CLI (the same data GET /guardrails/overview gives from the files) |
 * | GET /guardrails/denials/commands        | sensitive     | the unmasked command text of blocked calls       |
 * | GET /guardrails/overview, /denials      | not sensitive | read-only, no command text (see threat-model T-13) |
 *
 * Why the folder reads carry no PIN: a PIN dialog per click would make a folder tree unusable, and what they answer is bounded by construction, not by the PIN:
 * folder NAMES (never a file or a content) inside the roots of the user's choice (`launchRoots`) and the parents of the folders his sessions already run in;
 * a path outside them is refused before the disk is touched, links are resolved against the roots, UNC paths and `..` are refused (backend/foldersScope.ts).
 * Starting a session in the folder it finds stays PIN-protected (POST /owned/launch). Threat-model line: T-14.
 *
 * backend/routeClasses.test.ts fails when a non-GET route is in neither list, so a new write route must be classified here.
 */
export const SENSITIVE_ROUTES: readonly string[] = [
  'POST /owned/launch',
  'POST /owned/fork',
  'POST /owned/:id/resume',
  'POST /owned/:id/switch',
  'POST /owned/:id/stop',
  'POST /owned/:id/interrupt',
  'POST /owned/:id/forget',
  'POST /owned/:id/permission-mode',
  'POST /owned/:id/permissions/:requestId',
  'POST /sessions/batch/reply',
  'POST /sessions/:sessionId/reply',
  'POST /sessions/:sessionId/hc-permission',
  // Removes a bypass: a guardrail is back for that session. Runs the plugin's admin CLI; the folder comes from the session, never from the caller (T-22).
  'POST /guardrails/grants/:id/revoke',
  // Creates a bypass: a guardrail is lifted for that session. The route reads the user's PIN access token from the Authorization header and hands it to the plugin's CLI (stdin only); session and folder come from the URL and the registry, never the body (T-23).
  'POST /guardrails/sessions/:sessionId/grants',
  // A GET, and the one read route behind the PIN: a blocked command is a risky one by nature and the journal keeps 500 unmasked characters of it. GET /guardrails/denials is the same list without them (threat-model T-13).
  'GET /guardrails/denials/commands',
];

export const NOT_SENSITIVE_ROUTES: readonly string[] = [
  // The custom groups only organize the user's view: names and session ids in the module state file (threat-model T-16). The CSRF guard still applies.
  'POST /groups',
  'POST /groups/order',
  'POST /groups/:id',
  'POST /groups/:id/delete',
  'POST /sessions/:sessionId/group',
  'POST /sessions/:sessionId/pin',
  'POST /sessions/:sessionId/seen',
  'POST /sessions/:sessionId/marks',
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

/** The GET routes that answer with data from the disk beyond the module's own state, and are deliberately without a PIN (see the table above). */
export const NOT_SENSITIVE_READ_ROUTES: readonly string[] = ['GET /folders/roots', 'GET /folders/list', 'GET /folders/search', 'GET /folders/recent'];

/**
 * GET /sessions/:sessionId/hc-permission answers the text of the permission dialog a terminal shows (the command or change to approve, up to 20000 characters),
 * and is deliberately without a PIN: it is polled every 2 s while a session waits, and a PIN dialog per poll is unusable. The same text is already readable by
 * any process of the same user in the transcript of the session (the tool call is written there). What it does NOT give is the power to answer: that is
 * POST /sessions/:sessionId/hc-permission, PIN-sensitive (SENSITIVE_ROUTES). Threat-model line: T-15.
 */
export const NOT_SENSITIVE_APPROVAL_READ_ROUTES: readonly string[] = ['GET /sessions/:sessionId/hc-permission'];
