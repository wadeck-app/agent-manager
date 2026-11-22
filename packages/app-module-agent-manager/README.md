`# app-module-agent-manager
`
`app-core module `agent-manager` (title Agents). **Partial slice: sessions from the Claude Code registry (pid-only liveness) plus the sessions owned by the daemon, transcript log and replies. No hooks yet.**
`
`| Part | What |
`|---|---|
`| `GET /api/modules/agent-manager/sessions[?show=alive\|all]` | `{ ok, sessions[], cards[], unreadable[], error?, errorText?, hiddenDead, generatedAt, summary }`; most recent status change first; always 200 when the route worked, a missing registry folder is `ok: false` with `error` (code, message, hint) |
`| `GET .../summary` | `{ ok, busy, idle, other, alive, dead, unreadable, generatedAt }` (alive sessions only in the groups) |
`| Page `/agents` | master-detail workspace: toggle Tree (default) / Groups / Inbox (`?mode=`, remembered), search in every mode (`/`), view options per mode, text size S/M/L/auto; filter `?show=`, poll 5 s |
| Page `/table` | one row per session (nav label "Table"), reached from the side menu only; not nested under `/agents`, else the shell highlights both entries |
`| Dashboard widget | Busy / Idle / Other / Alive tiles |
`
`Registry folder: `$AGENT_MANAGER_SESSIONS_DIR`, else `~/.claude/sessions` (read through \`@wadeck-app/agent-manager-core\`). Status group: \`busy\`, \`idle\`, anything else (e.g. \`waiting\`, \`shell\`) is \`other\` with its raw text.
`
`The cards are DSL nodes built by the route and spliced with an \`ExtensionSlot\` (dsl-ui has no repeater outside DataTable); session text is neutralised so a name starting with \`$\` is never evaluated.
`
`Commands: \`npm run build\`, \`npm test\`, \`npm run check\`, \`npm run bundle\` (\`BUNDLE_VERSION\` required). Run these with \`APP_CORE_PORT\` on a dead port: check/package ask the running app-core for its shell versions. Dev: \`app-core-cli dev . --ab-tests\` with \`APP_CORE_CONFIG_DIR\` on a temp folder.

## PIN for sensitive actions

Launch, resume, stop, interrupt, permission mode, permission decision and sending a reply are app-core sensitive routes (list: `src/commons/routeClasses.ts`). The UI sends them through the shell fetcher, which opens the PIN dialog. Needs app-core-cli 2026.11.20-212 or later: an older one makes the UI refuse these actions and say to run `app-core-cli update`.

- Once: `app-core-cli pin set` in a terminal. Without it these actions answer 403 `pin-not-set` and the UI says so.
- Cancelling the dialog cancels the action: do it again.
- Pin, seen, forget and the transport preferences need no PIN.
