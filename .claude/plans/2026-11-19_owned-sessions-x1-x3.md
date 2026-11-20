# Owned sessions: launch X1 (stream-json child) and X3 (hc run), test both in use

Source: user 2026-11-19 ("fais X1 et X3 pour tester les deux a l'usage"). Evidence: `research/session-launch-options.md` rounds 1-3.

## Scope warning

This is the daemon milestone, not a feature on top of M1b. Today there is no daemon (`start`/`stop`/`status` fail), no launch UI, no permission UI for owned sessions. Each phase below ships and is verified on its own; until Phase 3 ends, nothing is usable from the UI.

## Two cases (user decision)

| Case | How the session appears | Reply path |
|---|---|---|
| X: launched by agent-manager | owned by us (we hold the handle) | X1: stream-json frames on the child stdin; X3: `hc send` |
| Y: discovered (registry, later hooks) | read-only discovery | existing `socket`, or `hc` if it runs in a herdr-core terminal |

Every row of the session list carries `launchedBy: "agent-manager" | "discovered"` and `host: "stream-json" | "hc" | null`.

## Decisions (reversible, log in `.claude/session/decisions.md`)

| Id | Decision | Why | Reverse |
|---|---|---|---|
| L1 | X1 children are owned by the daemon (`singleton-daemon-kit`), not by the app-core module backend | an owner exit kills the child; module reloads and `cli update` restart the backend | host the manager in the backend (one adapter) |
| L2 | X3 needs no ownership: launch with `hc run --bg --cwd --name claude ...`, reply through the existing hc transport | the terminal outlives the manager (measured) | none needed |
| L3 | Launch UI offers both and remembers the last choice | user wants to compare in use | remove one option |
| L4 | Permission approval for X1 is in scope (structured, `can_use_tool`); remote approval of X3 prompts via `hc keys` is NOT (decision #36 pending the user) | security posture | n/a |
| L5 | No frames or flags beyond those proven in round 2; version of `claude` recorded at launch and shown | `stdio` and raw frames are not in the docs | n/a |

## Phases

| Phase | Content | Done when |
|---|---|---|
| 1 core | `agent-manager-core/src/launch/`: `StreamJsonSession` (spawn, JSON line framing, init, send, interrupt, set_permission_mode, can_use_tool queue + allow/deny, command_lifecycle -> delivery, exit handling, kill), `HcLauncher` (`hc run`, resolve terminal), a fake `claude` for tests | unit tests with the fake; one real Haiku smoke script run once |
| 2 daemon | `start`/`stop`/`status` on `singleton-daemon-kit` (loopback, bearer token, port 47930 or `AGENT_MANAGER_DAEMON_PORT`, tests port 0), session host API: launch/list/send/interrupt/permission/stop, SSE events, state file of owned sessions (id, cwd, host, model, claude version) for `--resume` after a daemon restart, `doctor` check | tests on port 0 in an isolated env; `agent-manager start/status/stop` verified with the built bundle |
| 3 module + UI | module routes proxy the daemon (CSRF kept); "New session" dialog (folder, host X1/X3, model, permission mode); owned badge; permission card Approve/Deny (X1); X1 interrupted turns shown as "interrupted" after a restart; reply transport `owned` (confirmation by `command_lifecycle`, no marker) | agent-browser on the real page: launch X1, send, approve a permission, interrupt; launch X3, send; both rows visible |
| 4 comparison in use | short usage notes in `research/`, then the choice | user decides |

## Rules for the work

- One owned session at a time while testing; no load, no burst (CLAUDE.md). Haiku only.
- Daemon start failure, missing `claude`, untrusted folder, unreadable state file: visible error with a fix, never a silent fallback.
- Children are killed only by the daemon that started them; leftovers after a crash are listed by `doctor`, never guessed.
- Every UI variant behind the A/B dock only if there are variants; the launch dialog is a single design.
- Record each new finding in `research/` before relying on it.

## Open (does not block Phase 1)

- Daemon idle grace and autostart by hooks (spec O-4): Phase 2 starts it by hand only.
- Behaviour of 10 concurrent owned sessions: needs the user's approval before any test.
