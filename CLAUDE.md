# agent-manager

Follows and answers Claude Code sessions (CLI `agent-manager`, web UI as an app-core module). Family-A CLI like `queue`, `task`, `project`.

**Status: M1b partial slice.** Exists: Sessions overview table in app-core, fed by the Claude Code registry (`~/.claude/sessions`, pid-only liveness: the `procStart` pid-reuse check is not implemented); master-detail layouts with transcript log and replies through the socket transport (pins, seen markers, audit); custom groups of agents in the Tree (#66, 2026-11-21: user-defined, collapsible, drag and drop or the M key, saved in the module state file, not PIN-gated, threat-model T-16). Daemon (owned sessions plan, Phase 2): `start [--detach]`, `stop`, `status` work (control port 47930 or `AGENT_MANAGER_DAEMON_PORT`), session host API and SSE on a second loopback port, `owned-sessions.json`. Three launch hosts, all used by the module and the launch dialog: `stream-json` (X1, a child owned by the daemon), `hc` (X3, a herdr-core terminal) and `bg` (X2, `claude --bg`: hosted by the Claude Code supervisor, observed by a 5 s poll of `claude agents --json --all` while one is live, permission prompts and interrupt only in `claude attach <id>`, replies through the socket transport; threat-model T-17). Also in the module: fork of an agent (`claude --resume --fork-session`, PIN-gated, T-18), threads from a message (`--resume-session-at`, cap of 3 live per source, T-19; mock tests plus an integration test gated by `AGENT_MANAGER_INTEGRATION=1`), host switch Web <-> hc with the same session id and a readiness-colored Move button (T-20; external-session adoption, bg and kill by pid deferred), remote approval of permission prompts through `hc keys` (allow once / deny, T-15), a read-only Guardrails page, per-session bypass list, revoke and Add bypass (Permissions tab, through the plugin admin CLI, PIN-gated, T-22 and T-23) with a collapsed Rules view, batch Add bypass and Remove bypass on a multi-selection (up to 20 sessions, one PIN prompt, T-24), and a folder picker with launch roots. Hooks and an own ConPTY host are discarded (user decision, `out-of-scope.md`). Missing: transcript tailing by the daemon; guardrails editing from the page (decision 61) and batch add / remove of bypasses. `cli register` / `cli unregister` work. PIN gate (2026-11-20): module write routes (launch, resume, stop, interrupt, mode, permission decision, forget, reply, hc-permission, fork, switch) and the read `GET /guardrails/denials/commands` are app-core `sensitive` routes (`commons/routeClasses.ts` is the source of truth; a test fails when a write route is unclassified); needs `app-core-cli pin set` once and app-core-cli >= 2026.11.20-212 (a host 209-211 gates the routes but the UI cannot ask the PIN; older than 209 ignores the option silently). The UI calls them with `appFetcher` of `@wadeck-app/app-core-sdk/shell` (PIN dialog, `data/http.ts`); non-sensitive writes use the plain client. Plan: `.claude/plans/2026-11-14_agent-manager-v1.md`.

## Agent reference docs

Spec folder: `.claude/specs/2026-11-14_agent-fleet-manager/`.

| File | Read it for |
|---|---|
| `_index.md` | decisions (numbered), open questions, status |
| `guiding-principles.md` | principles every change must respect |
| `out-of-scope.md` | what not to build |
| `threat-model.md` | assets, threats, mitigations |
| `architecture.md` | packages, commands, daemon, data flow |
| `research/README.md` | index of measurements and studies (`research/`, `poc/`) |

## Layout

| Path | Role |
|---|---|
| `packages/agent-manager-core` | pure model (private): `readSessionRegistry`, liveness, no console/exit |
| `packages/app-module-agent-manager` | app-core module `agent-manager` (title Agents): routes `/sessions`, `/summary`, pages `/agents` (workspace: Tree/Groups/Inbox toggle `?mode=`, search, sub-agent A/B tests) and `/table` (nav "Table", a sibling path: the shell highlights every entry whose path is a prefix of the URL); `npm run check`, `npm run bundle` (needs `APP_CORE_PORT` on a dead port) |
| `packages/agent-manager-cli` | source package (private). CI publishes the generated `@wadeck-app/agent-manager-cli` (dist wrapper + `-win32-x64`, `-darwin-arm64`, `-linux-x64`) |
| `packages/agent-manager-cli/ci/` | bundle, Go launcher build, platform package generation, install/update checks |
| `test-support/` | test isolation: redirects HOME, XDG, `AGENT_MANAGER_CONFIG_DIR`, app-core; guard fails a run that changes the real config folder |
| `poc/` | M0 measurement scripts (throwaway) |

Config dir: `$AGENT_MANAGER_CONFIG_DIR`, else `$XDG_CONFIG_HOME/agent-manager`, else `~/.config/agent-manager`. Version constant injected by esbuild: `__AGENT_MANAGER_CLI_VERSION__`.

## CLI Development Workflow

1. Verify locally: `npm test`, `npm run build`, `BUNDLE_VERSION=0.0.0-local npm run bundle`, `violations check`. The tags `ts`, `cli`, `react`, `tailwind`, `shared` are all enabled (`.violations/config.ts`): no bare button or text input in product code (use the dsl-ui base components; the bare cases go through `ui/RowButton.tsx` and `ui/BareInput.tsx`, the only exemptions), no static className over 80 characters (named constant). CI runs `violations check` (ubuntu job).
2. Run the bundle only in an isolated env (temp HOME/USERPROFILE, `AGENT_MANAGER_CONFIG_DIR`, `XDG_CONFIG_HOME`, `autoUpdate: false` in its `config.yml`).
3. Commit and push to `main`. CI (`.github/workflows/publish.yml`) tests on 3 OS, builds the Go launcher, computes the CalVer version, publishes the platform packages then the main package, then `verify-install` installs the published version on 3 OS.
4. Wait for CI: `queue wait ci <sha> --name agent-manager.ci-<sha7> --cli-foreground` (run in background, ALONE: never append `; echo $?`, the notification would show the echo's 0; read the printed verdict and cross-check the run with the Actions API, see `.claude/kb/lessons-learned.md`).
5. Check the registry: `npm view @wadeck-app/agent-manager-cli versions --registry=https://npm.pkg.github.com`.
6. Update the local app: `UPDATER_MANUAL=1 agent-manager cli update`, then `agent-manager -v`.

First install on a machine: `npm install -g @wadeck-app/agent-manager-cli`. Needs `@wadeck-app:registry=https://npm.pkg.github.com` and a token with `read:packages` in `~/.npmrc`.

A dev build (`0.0.0-local`, not CalVer) refuses `cli update` and `cli rollback`, and never schedules a background update.

## Rules

- Windows-first; ASCII only in source and docs (a `violations` rule fails otherwise).
- Never register a source checkout with the real app-core in tests: `APP_CORE_PORT` to a dead port and `APP_CORE_CONFIG_DIR` to a missing directory; daemon tests use port 0 and an isolated env.
- No silent fallback anywhere: missing hooks, unavailable transport, unreadable registry all produce a visible, actionable message. A command that is not implemented fails with a message, never succeeds.
- Every UI variant is wired into the real page behind the A/B dock and verified with `agent-browser`.
- No load test, benchmark or burst of sessions without explicit user approval (M7 and any M0 step beyond 2 sessions).
- Record every new finding in `research/` before relying on it.
- `@wadeck-app/*` libraries: `latest`; same-workspace packages: `*`; never `^`, `~` or `>=0.0.0-0` on them (skill `wadeck-npm`).
- Node scripts only, no Python.
