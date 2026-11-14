# Plan -- agent-manager v1

**Spec:** .claude/specs/2026-11-14_agent-fleet-manager/
**Design:** `architecture.md` in the spec folder. Research and measurements: `research/`, `poc/`.

## Known gaps / partial -- read first

This plan is a design, not a validated one. These are unverified and block or can change later milestones:

| Gap | Why it matters | Resolved at |
|---|---|---|
| Hook-spawn cost per event is unmeasured (decision 16 assumes async observers are cheap); reviewer data: 301,262 PostToolUse runs in w-warp logs, median `durationMs` 145 ms | with 10+ sessions, every tool call would fire a hook; decision 29 removes PreToolUse and PostToolUse from the default set | M0 |
| Registry `status` during a permission dialog; detached daemon survival and console flash on Windows; socket `msg_id` dedupe; transcript growth per async hook (all UNVERIFIED) | decisions 30, 29, 37 | M0 |
| Hook-delivered reminders: how they appear in the transcript (confirmation for hook transports) | delivery states (decision 33) | M4 |
| Windows ACL of `health_token` and session `.key` files | T-10 | M1 |
| D-B (w-guardrails deny rule for curl to the reply route) pending the user | T-08 | M4 |
| All PoC numbers come from headless `-p` sessions, one machine, Haiku, n <= 5 | interactive sessions may differ (`asyncRewake` exit delay, Stop hook behavior, socket wake) | M0 |
| Plain `async: true` behavior and the default 600 s hook timeout were not tested | observers and reply hooks depend on both | M0 |
| `Read` on an upload path outside the project in default permission mode (PoC used `--allowedTools Read`) | image-by-path may prompt the user | M0 |
| The socket protocol is private; last contract-tested version was 2.1.319, PoC ran on 2.1.325; protocol can change in any release | default transport depends on it | M4 + `doctor` |
| Hook payload fields for Stop, SubagentStop, PreCompact, SessionEnd, Notification and the event -> state mapping are unverified | state model (decision 14) | M2 |
| How to read the OS process start time on Windows (`procStart` is a FILETIME, reviewer-verified; Node has no API: spawn or named-pipe connect probe) | liveness without pid reuse | M0 |
| Sub-agent messages are not in the main transcript (reviewer-verified, 0 `isSidechain:true` lines in the main file); 12 unexplained `isSidechain: null` lines remain; parallel and nested spawns untested | sub-agent tree correctness | M5 |
| No measured budget for the daemon at 10+ sessions | scale claims | M7 (needs user approval) |
| herdr `pane.send_text` params and bracketed paste undocumented | herdr transport | M4 |
| CI publish pipeline: repo exists (`origin`, decision 20) and CI is pre-approved (decision 28); GitHub repo settings (Actions `GITHUB_TOKEN` packages write, package visibility) cannot be read from here | family-A release flow | M1 (first CI run) |

Parked and not planned: v2 (bypass UI), v3 (MCP questions), v4 (OpenCode/Codex).

## Principles for execution

- Windows-first; ASCII only in app-module code (a `violations` rule fails otherwise).
- Never register a source checkout with the real app-core in tests: `APP_CORE_PORT` to a dead port and `APP_CORE_CONFIG_DIR` to a missing directory (agent-fleet lesson, `lessons-learned.md:6646-6718`); daemon tests use port 0 and an isolated env.
- No silent fallback anywhere: missing hooks, unavailable transport, unreadable registry all produce a visible, actionable message.
- Every UI variant is wired into the real page behind the A/B dock and verified with `agent-browser`.
- No load test, benchmark or burst of sessions without explicit user approval (M7 and any M0 step beyond 2 sessions).
- Record every new finding in `research/` before relying on it.

## Milestones

### M0 -- Measure before building

| Item | Detail |
|---|---|
| Work | (0) free data first: mine `hook_success.durationMs` from existing transcripts (per hook, per event; reviewer found median 145 ms for w-warp `on-post-tool-use.js`), count transcript growth from `attachment` and `async_hook_response` lines; read-only, no session started; (0b) registry: does `status` change during a permission dialog (observe the user's live sessions read-only); how to read process start time (PowerShell spawn cost) versus a named-pipe connect probe; (0c) detached daemon started from a hook survives the end of that session, no console flash (hidden-process recipe `docs/windows-hidden-process.md`); (0d) socket `msg_id` dedupe and `priority` behavior (headless, 2 sessions max); (0e) evaluate the Claude Code mod API (`turn.start`, `tool.call`, `session.send`) as an alternative state source, behind an interface; (1) hook-spawn cost: a stub hook (same bundle shape as the CLI) on the events of M2, measure node cold start wall time and CPU per call on Windows, with 1 then 2 sessions, and extrapolate to the PostToolUse volume seen in w-warp logs (256k events with an `agent_id`; `research/w-warp-herdr-hooks.md`); measure the alternative of one long-lived forwarder and, if available, an HTTP hook (availability UNVERIFIED) and pick one before M2; (2) interactive-session check: socket wake, `asyncRewake` wake/re-arm, hot-wait in one **interactive** session (needs the user to launch it with a provided `--settings` file; the harness cannot allocate a TTY) ; (3) plain `async: true` observer does not delay the turn; (4) default-timeout behavior read from the docs and tested once with a short value; (5) `Read` of an out-of-project image path in default permission mode; (6) re-run the socket contract on 2.1.325 only with user approval (about 15 model turns) |
| Exit | numbers and a verdict per gap written into `research/poc-report.md` (new section); decision 16 confirmed or revised in `_index.md` |
| Tests | scripts under `poc/scripts`, results under `poc/results`; no process left (`alive.js`) |
| Limits | at most 2 concurrent headless sessions; message only sessions the scripts started |

### M1 -- Skeleton, daemon, module registration

| Item | Detail |
|---|---|
| Work | monorepo (core, service, sdk, cli, app-module, claude-plugin); typed `Command` dispatcher; **CI publish pipeline copied from the siblings (decision 28): `npm install -g @wadeck-app/agent-manager-cli` works, first CI run and registry check**; `createDaemon` with token and port file (default port 47930, decision 40); **Windows ACL check of `health_token` (T-10)**; per-command exit-code table; module-backend-to-daemon SSE notify path with a module reload mid-stream test (decision 34); `status`, `start`, `stop`, `cli self-check`; empty module registered through `registerModule` (best-effort); `doctor` v0; duration parser (decision 26) |
| Copy | module structure from `app-module-flow` (manifest, `registerRoute`, YAML views, `views.test.ts` source/route consistency, manifest test pinning `dslLib.shared`) |
| Exit | `agent-manager status` works against a started daemon; module appears in a **test** app-core started with an isolated config dir; `app-core-cli check` and `package` pass; architecture test enforces package direction |
| Tests | unit, spawn-isolated CLI tests (`spawnIsolated` pattern), real-server integration test for module routes, port 0 everywhere |
| Needs the user | nothing blocking: repo exists and CI is pre-approved (decision 20, 28), CLI name decided (decision 18). First `npm install -g` needs the `@wadeck-app` registry and a `read:packages` token in the user's `~/.npmrc` |

### M2 -- Hooks plugin and state

| Item | Detail |
|---|---|
| Work | plugin `hooks.json`: low-volume async observers only (decision 29: no PreToolUse, PostToolUse opt-in), `node "<absolute>/hook.cjs" <event> <plugin-version>` called directly, no `%USERPROFILE%`; plugin release path decided (this monorepo versus the `Wadeck/claude-w-plugins` marketplace) and `doctor` plugin-version check; `hook <event>` forwarding; session store; state model with the registry watcher as primary source (decision 30) and `permission_summary` (decision 36); registry reader with `procStart` liveness; `sessions`, `doctor` hook checks; UI fleet list (YAML) with state badges and the navbar "waiting" count |
| Verify | event -> state mapping against real payloads captured from the user's live sessions (read-only, by reference) and stored as fixtures recorded under a throwaway `HOME`; record Stop/SubagentStop/Notification/SessionEnd/StopFailure/MessageDisplay fields in `research/` (log undocumented events at full length) |
| State rules | sub-agent events (`agent_id`) never change main-session state; leave waiting-permission via PostToolUse/PostToolUseFailure/UserPromptSubmit/Stop/PermissionDenied plus a timeout fallback (manual deny fires no hook); waiting-user from Stop, `idle_prompt` only refines; error never from failures alone; hooks fail open (exit 0, never 2), no sleeps, no extra spawns |
| Exit | `sessions` lists all live sessions with correct states during normal use; killing a session marks it ended; missing plugin shows the banner and a `doctor` error with the install command |
| Tests | fixture payloads per event; liveness test with a reused-pid simulation; hook CLI always exits 0 even with the daemon down (failure logged) |

### M3 -- Transcript tailer and log viewer

| Item | Detail |
|---|---|
| Work | incremental tailer (offset, partial line, truncation, watch + poll; skip `attachment` and `api-request-blob` lines by prefix without `JSON.parse`, coalesced wakeups, decision 29); normalized model with tool call pairing; search over transcripts (decision 38); SSE stream (notify only) + refetch; `LogStream` with collapsed tool calls and fold; Edit diffs, TodoWrite, thinking blocks, cost and context from `message.usage`; safe markdown; `tail` command |
| Copy | `foldQuietRuns`/`LogLine`/`LogGroupSection` design (rename step -> turn, attempt -> sub-agent), `MarkdownText`, `SafeLinkTarget`, `AnsiStrip`, `LogBuffer`, `useAutoScroll`, `ToolCallTracker` (add `isSidechain`; do not copy `StreamEventMapper`), `mock-fidelity` + drift check |
| Do not copy | `useTaskLogs` offset heuristic, fake virtualization, regex re-parsing of tool calls, the transport layer |
| Exit | a 10 000-line transcript opens without rendering all of it; tool calls collapsed by default and expandable; a running session updates live with one SSE stream; Claude Code version drift warning works |
| Tests | tailer tests (partial line, rotation, truncation), model tests on recorded real transcripts (sanitized fixtures), `LogStream` component tests, `agent-browser` pass on the real page |

### M4 -- Reply transports, composer, images

| Item | Detail |
|---|---|
| Work | `ReplyTransport` interface; `socket` (reimplemented from the documented-by-code frame, token and registry rules), `asyncRewake`, `hotwait`, `queue-mod`, `herdr` adapters; daemon mailbox (id, expiry, consume once); delivery states with transcript confirmation; audit log; origin marker; composer with image paste/drop (client-side downscale, base64 in JSON at most 700 KB per request, decision 32); uploads dir; `send` and `transports` commands; transport switch (global + per-session); user-selectable priority and `msg_id`/`session_id` in socket frames (decision 37); confirmation window parsed with the duration parser (default 0), soft "probably not delivered" hint after `hintAfter` 15 s and the "queued in session" state (decision 33); reply-route hardening: same-origin + CSRF header + per-target rate limit (decision 31, T-08), D-B answered by the user before this milestone closes |
| Verify | per transport on 2 live sessions the probe, send, confirm and failure message; herdr params via `herdr api schema --json` (read-only) |
| Exit | each transport can be selected from the UI and delivers a reply to an idle session or fails with an actionable reason; an image pasted in the browser reaches the agent as a readable path; unavailable transport never falls back silently |
| Tests | transport contract suite (shared, like `runBackendContract`) run against fakes and against headless sessions the test spawns; stale-reply test; duplicate-send test |

### M5 -- Sub-agents

| Item | Detail |
|---|---|
| Work | sidechain/`meta.json` reader, tree linked by `toolUseId`, live state from SubagentStart/Stop, tree in the session view; model keeps `fork-context-ref`, `isFork`, `background`, `spawnDepth`, `model` (decision 38); tests with parallel and nested spawns |
| Exit | a session that spawns parallel sub-agents shows the tree with states; question about sub-agent messages in the main transcript answered in `research/` |
| Tests | fixtures from real sessions; parallel `tool_use` blocks in one message handled |

### M6 -- A/B variants and polish

| Item | Detail |
|---|---|
| Work | layouts A/B/C wired into the real page; experiments for tool-call density, composer placement, time display; keyboard flow (jump to next waiting session, focus composer); empty/error states; notifications (tab title and favicon badge from a module route, optional daemon OS toast, best-effort `agent.session.waiting` event through queue-sdk, "only when not focused", decision 35); one SSE per browser via a leader tab (Web Locks + `BroadcastChannel`, no workers or `<audio>` under the CSP, decision 34); composer drafts persisted per session in localStorage; stuck badge, registry name and `permissionMode`, jump to terminal via herdr (decision 38); permission approve/deny from the UI stays a parked v1.5 question |
| Exit | every variant clicked through with `agent-browser` on the real page, console clean; user picks defaults; winners baked in later |
| Tests | component tests per variant; `agent-browser` scripts |

### M7 -- Benchmark harness (only with explicit user approval)

| Item | Detail |
|---|---|
| Work | harness comparing transports (latency, memory, process count, CPU) and the daemon at 10+ sessions; results in `research/` |
| Gate | ask the user before each run; state the sessions, turns and cost beforehand |
| Exit | measured budget per transport and daemon; defaults revisited |

## agent-fleet pieces by milestone

| Milestone | Piece |
|---|---|
| M1 | `app-module-flow` structure, `AppCoreRegistration.ts`, `views.test.ts`, manifest pin test |
| M3 | log-stream components and model, safe markdown, `AnsiStrip`, `LogBuffer`, `useAutoScroll`, `ToolCallTracker`, `StreamJsonParser` line buffer idea, `readAppendedLog` idea, `mock-fidelity` drift check |
| M3-M6 | `LogStreamChoices` A/B pattern, "notify then refetch", single refresh source |
| M4 | none (no reply or image code exists there) |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Claude Code update breaks the socket or transcript format | replies lost, parse errors | confirmation from the transcript, `undelivered` state, version warning, contract test, raw-line passthrough |
| Hook spawn cost too high at 10+ sessions | machine slowdown | M0 measurement; fallback design: SDK client in a long-lived helper or batching (to design only if needed) |
| Interactive sessions differ from headless | wrong transport defaults | M0 interactive check |
| Image path triggers permission prompt | image flow degraded | M0 check; document a settings allow rule if needed |
| Stale or duplicate replies | agent acts twice | message id, expiry, consume once, no auto-resend |
| app-core DSL limits (no inline style, CSP, no `data:` images) | UI features blocked | `dslLib` components, images served from a module route |
| Overlap with w-warp / herdr hooks | duplicated state | accepted by the user (decision 23); hook volume reduced by decision 29 |
| Agent-to-agent injection through the unauthenticated loopback route | an agent types into another session | decision 31 hardening; D-B pending (T-08) |
| Upload route limits (1 MiB body, JSON only) | image paste fails with 413/415 | base64 at most 700 KB, client-side downscale (decision 32) |
| Scope growth into agent-fleet or flow territory | wasted work | decision 4; out-of-scope list |
| Variants ship to production | exposed experiments | nothing confidential in variants; bake winners |
