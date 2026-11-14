# Architecture -- Agent Fleet Manager (v1)

**Version:** v0.1
**Last updated:** 2026-11-14
**Status:** Draft (derived from decisions 1-17; most decisions are provisional)

Labels: **proposed** = design choice made here, reversible; **agent report** / **UNVERIFIED** / **[V]** as in `research/`. Nothing below is built; every measured number comes from `research/poc-report.md` (headless sessions only).

## Overview

`agent-manager` is a Windows-first CLI + local daemon + app-core module. Claude Code global hooks (shipped as a plugin) feed the daemon with session state; the daemon tails transcripts in place; the module backend serves one SSE stream and REST routes to a React UI inside app-core. A reply typed in the UI travels daemon -> chosen `ReplyTransport` -> live session. Not responsible for: launching or orchestrating agents (that is `agent-fleet`/`flow`), permission decisions (w-guardrails), anything beyond Claude Code in v1.

## Decisions (see `_index.md` for status and rationale)

| # | Decision | Used in |
|---|---|---|
| 1 | TypeScript/Node >= 22, family-A layout, `singleton-daemon-kit` daemon, app-core module | Packages, Daemon |
| 2 | Thin hooks, never block, log failures | Hooks, Doctor |
| 3 | Transcript JSONL is the content source, hooks give live state | Tailer, State |
| 4 | Not a fork of agent-fleet; observes user-started sessions | Overview |
| 5 | Images travel as a file path in the text | Images |
| 6 | Channels out (Bedrock) | Transports |
| 7 | Pluggable, UI-switchable reply transports; numbers first | Transports |
| 8 | One SSE stream, notify-then-refetch, polling only as visible fallback | Live push |
| 9 | YAML views + custom React `dslLib` components | UI |
| 10 | Transcripts read in place, referenced by offset, never copied | Tailer |
| 11 | Loopback only; audit log + origin marker on web replies | Security |
| 12 | Research persisted under `research/` | -- |
| 13 | Hooks ship as a Claude Code plugin; `doctor`/UI warn on missing hooks | Hooks |
| 14 | State model from hook events; sub-agents from SubagentStart/Stop + sidechain files | State, Sub-agents |
| 15 | One page, layouts A/B/C behind the A/B dock, default C | UI |
| 16 | Observation hooks `async: true`; only reply hooks are non-plain | Hooks |
| 17 | Transcript content shown unmasked in v1 | Security |

## Design

### Packages (family A, like queue/task)

| Package | Role | Rule |
|---|---|---|
| `agent-manager-core` | storage, models (session, event, turn, tool call, sub-agent), transcript reader/tailer, state store | no I/O outside its own dirs; harness-agnostic model (P-4) |
| `agent-manager-service` | pure use cases (record hook event, list sessions, send reply, doctor) | no console, no `process.exit` |
| `agent-manager-sdk` | zero-dependency client: `publishHookEvent`, `ensureDaemon`, never throws | imported by the hook CLI |
| `agent-manager-cli` | typed `Command` objects (project pattern), daemon (`createDaemon`), updater, transports | exe-in-npm, esbuild CJS bundle, CalVer |
| `app-module-agent-manager` | `manifest.json`, `src/backend`, `src/dsl-views/*.yaml`, `src/dsl-components` | built with `app-core-cli check` + `package` |
| `claude-plugin-agent-manager` | Claude Code plugin: `hooks.json` calling `agent-manager hook <event>` | versioned with the CLI |

Dependency direction enforced by an architecture test (as in task). Platforms: win32-x64 first; others only if cheap. Layout and CI follow `research/sibling-clis.md` (partly stale doc: verify at M1).

### Commands (proposed; `--json` on all, `{error, hint}` on failure)

| Command | Purpose |
|---|---|
| `hook <event>` | read stdin payload, forward to the daemon; **always exits 0**, never prints a decision, logs failures to `logs/` |
| `start` / `stop` / `status` | daemon lifecycle (hooks start it on demand via the SDK) |
| `sessions` | list sessions with state, name, cwd, transport, last event |
| `tail <session>` | follow a session's normalized events (snapshot-diff like task `--follow`) |
| `send <session> <text> [--image <path>] [--transport <id>]` | same path as the UI reply |
| `transports` | list transports, probe result per session, current default |
| `doctor` | hooks present and current, daemon, app-core registration, registry readable, `crossSessionInbound`, Claude Code version vs last contract-tested version; every failure has an actionable hint |
| `cli update|version|rollback|logs|self-check|register|unregister` | from `shared-cli` / `shared-updater` |

Exit codes (proposed, align with queue `exitCodes.ts` at M1): 0 ok, 1 failure, 2 timeout, 3 daemon unreachable, 4 usage (unknown option gives a "did you mean" hint).

### Data flow

```
Claude Code (N sessions)
  hooks (async, plugin) --stdin--> agent-manager hook <event> --HTTP loopback--> daemon
                                                                                  |
          ~/.claude/sessions/<pid>.json (registry, liveness) ----read-------------+
          transcript JSONL (path in payload) --tail by byte offset---------------+
                                                                                  v
                                        state files + offset index (~/.config/agent-manager)
                                                                                  |
                                          notify (session id, offset)             v
   browser <--SSE-- module backend (app-core) <--read files / call daemon-- daemon
      |                                                                          ^
      +-- reply (text + pasted image) --POST--> module backend --> daemon --> ReplyTransport --> session
                                                                                  |
                          transcript line with origin marker --tail--> "confirmed" -+
```

The module backend reads state files directly (queue pattern) and calls the daemon only for actions. One refresh source: the SSE stream carries only notifications; the UI refetches (decision 8, agent-fleet lesson).

### Daemon

| Item | Design |
|---|---|
| Base | `createDaemon` from `singleton-daemon-kit`: loopback HTTP, bearer token in `health_token` (0600), `config.port`, port env override `AGENT_MANAGER_DAEMON_PORT`, tests use port 0 |
| Start | on demand from the first hook or `start`; registers the app-core module on every start (best-effort, as `AppCoreRegistration.ts`) |
| Idle shutdown | proposed: when no live session is registered for a grace period (value TBD at M1); queue uses 60 s with no pending work |
| Hook ingress | `POST /hook` small JSON `{event, payload ref}`; payloads stored by reference (decision 10) |

### State model (decision 14, refined by `research/w-warp-herdr-hooks.md`; the event -> state mapping is still UNVERIFIED on real payloads, M2 checks it)

| State | Entered by (proposed) |
|---|---|
| starting | SessionStart (`source` startup/resume/clear/compact/fork kept, matcher `^(startup\|resume\|clear\|compact\|fork)$` as herdr) |
| working | UserPromptSubmit, PreToolUse, PostToolUse (main session only) |
| waiting-permission | PermissionRequest, Notification `permission_prompt` |
| waiting-user | Stop (turn ended, waiting for the user); Notification `idle_prompt` (~60 s late timer) only refines, `elicitation_dialog`, `agent_needs_input` |
| idle | Stop with nothing pending, refined by `idle_prompt` |
| error | StopFailure with a confirmed error type (fields UNVERIFIED); PostToolUseFailure alone never means error (2,460 in w-warp logs) |
| ended | SessionEnd (fields UNVERIFIED), or registry entry dead (liveness) |

Rules from the w-warp/herdr study:
- **Sub-agents:** every event is tagged with `agent_id` and `agent_type`; events with an `agent_id` never change the main session's state, they update a child entry (PostToolUse, PostToolUseFailure, PermissionRequest and StopFailure carry it; Stop and session-level events did not in 17,447 Stop runs).
- **Leaving waiting-permission:** PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop and PermissionDenied (auto-mode denials only). A manual deny fires no hook (w-warp README:113), so the state also expires by a timeout fallback (value set at M2) and shows "unconfirmed" instead of staying blocked forever.
- **Volume:** PostToolUse is the largest stream (256k events with an `agent_id` in w-warp logs); the daemon coalesces them per session.

The registry `status` field is a cross-check and the fallback when hooks are missing (the UI shows a "hooks missing" banner, never a silent downgrade).

### Liveness

A session is alive when its registry file exists, the pid is running **and** the registry `procStart` matches the OS process start time. Pid-only checks (as `claude-inbox.js:34-42`) miss pid reuse ([V]). The `procStart` format looks like a Windows FILETIME (UNVERIFIED), M2 confirms. A failed connect to the messaging socket also marks a session undeliverable.

### Transcript tailer and sub-agents

| Item | Design |
|---|---|
| Reading | per active session: read from the stored byte offset, keep a partial last line, handle truncation, `fs.watch` with a poll fallback (Windows file locking, UNVERIFIED behavior) |
| Model | normalized `turn`, `message`, `toolCall` (paired by `tool_use.id` / `tool_result.tool_use_id`, with duration and one-line summary), `subagent`; unknown line types kept as raw, never dropped silently |
| Index | offsets of turns for paging; content stays in the transcript (decision 10) |
| Drift | record the Claude Code version that produced each parse; `doctor` warns when it is newer than the last tested (agent-fleet `mock-fidelity` pattern) |
| Sub-agents | tree from `subagents/agent-<id>.jsonl` + `.meta.json` (`toolUseId` links to the parent `Agent` call); live state from SubagentStart/Stop; `isSidechain` lines never merged into the main flow; whether sub-agent messages also appear in the main file is UNVERIFIED |

### ReplyTransport (decision 7)

Interface (no code): `id`, `describe()`, `probe(session)` -> `{available, reason, fix}`, `send(session, message)` -> `{accepted, detail}`. `message` = `{id, text, imagePaths[], origin}`. A transport never confirms delivery itself.

| Transport | Wakes idle | Measured (2.1.325, headless) | Resident cost | Main risk |
|---|---|---|---|---|
| `socket` (claude-inbox protocol, reimplemented in the daemon) | yes | 5/5, first event ~330 ms | none; sender 69 MB transient in the PoC (a daemon call has no extra process: UNVERIFIED) | private protocol, no ack, held in bypass sessions without `crossSessionInbound: accept` (set here, `settings.json:84`) |
| `asyncRewake` | yes | 3/3, first event ~117 ms, re-armed by the Stop hook | +43-50 MB private, +4 processes per session | timeout leaves the session deaf until the next Stop; stale replies; ~30 s exit delay |
| `hotwait` (blocking Stop hook) | no (open turn only) | detect 45-200 ms, answer ~1.3 s; idle after expiry | one held hook process | bounded by timeout; 8-continuation cap; turn looks long |
| `queue-mod` (w-agent-wake via `agent.message`) | yes | not measured here; older cost table +195 MB working set per session (2.1.319) | mod + `queue wait` chain | mod API moving; needs queue running |
| `herdr` (`pane.send_text`) | yes, panes inside herdr only | not measured | none | beta on Windows, params undocumented, pane mapping from herdr hook |

Rules (proposed):
- **Selection (decision 19):** global default plus per-session override, both visible on screen (transport chip in the composer and the rail) and switchable in one click or one key, mid-conversation. CLI: `agent-manager transports [list|set <id> [--session <id>]|probe]`. Each transport shows its live measured latency (send -> first transcript sign) so differences are visible while you use them. Proposed default `socket` (no resident cost); reversible.
- **No silent fallback (P-2):** if the chosen transport is unavailable the send fails with the probe `reason` and `fix`; the user switches. No automatic ladder in v1.
- **Mailbox for hook transports:** the daemon serves the pending reply over loopback (long-poll for `hotwait`, wait for `asyncRewake`); each reply has an id and an expiry, and is consumed once. The PoC used files and showed a stale file answered late (inference); the daemon mailbox must expire or acknowledge.
- **Delivery states:** `queued` -> `sent` (transport accepted) -> `confirmed` (a transcript user line with the origin marker and message id appears within a window) or `undelivered` (window passed; UI offers resend through another transport). The window value is TBD at M4. Duplicates: the socket does not dedupe (A10), so the daemon never auto-resends.
- **Origin marker (decision 11):** delivered text starts with `[web reply via agent-manager #<id>]`; hook-delivered text arrives as a system reminder (lower authority, can be ignored), socket text as a user message.
- **Audit log:** every web reply (session, time, text, transport, outcome) in `audit/<day>.ndjson`, shown in the UI.
- **Contract test:** run after each Claude Code update (`doctor` flags the version), reusing the idea of `tests/contract/socket-contract.js` against headless sessions the test itself spawns.

### Images (decision 5)

Paste/drop in the composer -> upload to the module backend -> daemon stores `uploads/<sessionId>/<msgId>-<n>.<ext>` (type by magic bytes, size cap TBD) -> the message text adds `The user attached an image: <absolute path>. Read it.` Measured: path in text answered correctly 3/3 with `--allowedTools Read`; an image block over the socket was ignored (n=1). **Not measured:** whether `Read` on a path outside the project asks for permission in default mode (M0 checks). app-core CSP forbids `data:` and `blob:` images, so previews (composer and transcript images) are served from a module route. Uploads purge at 90 days or 200 MB, like every other data category (decision 21).

### UI (decisions 8, 9, 15)

| Page / part | Implementation |
|---|---|
| Main page (fleet) | `AbTest` with variants: A "needs me" inbox, B fleet board, C session rail + focus pane (default); "needs me" badge and counter in the rail from day one |
| Session view (inside C, route for A/B) | custom React: log stream, tool-call cards, sub-agent tree, composer |
| Transports / Doctor | YAML view: transport probe table per session, default switch, doctor results |
| Navbar widget | count of sessions waiting for the user |

Components to build as `dslLib` React: `LogStream` (design from `app-module-flow` `LogStreamView`/`LogLine`), `ToolCallCard`, `SubagentTree`, `Composer`. Rules: tool calls collapsed by default with a one-line summary (`summarize()` idea: command, path, pattern, url, query, description) and expandable input/output; runs of 3 or more consecutive tool calls fold into "N tool calls" (`foldQuietRuns` idea; errors and the last call are never folded, proposed); safe markdown, ANSI stripping, 20,000 char cap with "show more"; auto-scroll that stops when the user scrolls up; real virtualization for long transcripts. Composer: multiline text, paste or drop images as chips with thumbnails, transport chip, delivery state of the last message, send on Ctrl+Enter (proposed).

A/B experiments (dev or `--ab-tests` only; variants ship to production, so nothing confidential in them): layout A/B/C, tool-call density and fold, composer placement, time display, grouping. Every variant is wired into the real page; the dock is verified with `agent-browser` before a variant is reported ready; winners are baked in and losers deleted (app-core `CLAUDE.md` rules).

### Scale (10+ sessions)

| Concern | Design |
|---|---|
| Hooks | `async: true`; one short-lived CLI process per event; **spawn cost UNMEASURED** (M0) |
| Tailing | only sessions that are alive and visible/recent are watched; offsets persisted; no re-parse |
| UI push | one SSE stream per browser tab; notifications coalesced per session; refetch by session and offset |
| Resident processes | none per session by default (socket transport); `asyncRewake` adds ~+0.5 GB for 10 sessions (arithmetic, not measured) |
| Budget | no measured budget for the daemon itself; M7 benchmark, only with explicit user approval |

### State layout (`~/.config/agent-manager`, override `AGENT_MANAGER_CONFIG_DIR`; proposed)

| Path | Content |
|---|---|
| `config.port`, `health_token` | daemon discovery and auth (siblings' pattern) |
| `config.yml` | default transport, retention, windows and timeouts |
| `sessions/<sessionId>.json` | state, last events, offsets, transcript path, pane mapping |
| `events/<day>.ndjson` | hook events by reference (91-day cap proposed, like queue history) |
| `audit/<day>.ndjson` | web replies |
| `uploads/<sessionId>/` | pasted images |
| `mailbox/` | pending hook-transport replies with expiry |
| `logs/<day>.ndjson` | command and hook-failure log (`cmd:`, `exit N (CODE)` lines like project) |
| `app-module/<version>/` | staged module copy (task/project pattern) |

Files use locked or atomic writes (`FileLock`, atomic rename).

### Hooks plugin (decisions 13, 16)

`hooks.json` registers: SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, Stop, StopFailure, SubagentStart, SubagentStop as plain `async: true` observers; reply hooks (`hotwait` on Stop, `asyncRewake` waiter) are separate entries enabled only when that transport is selected. PreToolUse and PermissionRequest observers must never return a decision (w-guardrails owns decisions). Coexists with existing hooks (w-warp, w-command-log, herdr, w-guardrails): all matching hooks run; overlap with w-warp and herdr is ignored (decision 23). Event payload fields for Stop, SubagentStop, PreCompact, SessionEnd, Notification, StopFailure, MessageDisplay are UNVERIFIED (M2).

Rules from the w-warp/herdr study (`research/w-warp-herdr-hooks.md`, decision 25):
- **Fail-open:** the hook wraps everything, exits 0 on bad JSON or an absent daemon, and never exits 2 for an observer; failures are logged and surfaced by `doctor` and the UI banner, never swallowed silently.
- **Raw payloads:** undocumented events (SessionEnd, StopFailure, MessageDisplay, SubagentStart/Stop) are logged at full length (w-warp's 180-char cap hid the key set); captured payloads become test fixtures, recorded under a throwaway `HOME`.
- **No sleeps, no extra spawns** in a hook (w-warp sleeps 300 ms/2 s and spawns `claude --version`); the daemon reads the transcript on Stop with a short retry if it is not flushed.
- **Paths:** `${CLAUDE_PLUGIN_ROOT}` works only in plugin hooks; a global (settings.json) hook needs an absolute path.
- **Matchers:** no wildcard matcher with a fail-closed hook (a crashing hook locked out every session, `kb/lessons-learned.md:5-7`).
- **Spawn cost (UNVERIFIED, M0):** a node process per event is what w-warp does without measuring; with 256k PostToolUse events in its logs it may add up. M0 measures node cold start on Windows; alternatives: one long-lived forwarder, or an HTTP hook if available (UNVERIFIED).

## Parked

| Phase | Note |
|---|---|
| v2 | Manage w-guardrails bypasses from the UI. Design issue from the research: today approval is a human `ask` dialog in the terminal; a UI writing `guardrails.bypass.json` directly would skip it. Grants are two-step nonce tokens bound to session, category and mode (`request-bypass.js`), state files are protected (`bypass-file-write` hardcoded deny). Reopen with a threat-model pass. |
| v3 | MCP server for structured questions (`Elicitation`, `agent_needs_input` events are the hook side). |
| v4 | OpenCode and Codex adapters through the harness-agnostic core (P-4); transcript and hook models must stay behind adapter interfaces. |

## Open questions (not decidable from the spec)

| # | Question | Needed by |
|---|---|---|
| O-1 | Hook-spawn cost per event and effect on 10+ interactive sessions | M0 |
| O-2 | Do the transports behave the same in interactive sessions (PoC was `-p` only)? | M0 |
| O-3 | Does `Read` of an upload path outside the project prompt in default permission mode? | M0 |
| O-4 | Default transport (proposed `socket`, user decides after seeing the metrics), hot-wait duration, daemon idle grace. Confirmation window and mailbox expiry resolved: decision 22 | M1-M4 |
| O-5 | RESOLVED (decision 23): overlap with w-warp and herdr hooks is ignored, but their hook designs are studied and reused (decision 24) | M2 |
| O-6 | RESOLVED (decision 20): `origin` = https://github.com/wadeck-app/agent-manager exists and is empty; CI publish pre-approved | M1 |
| O-7 | RESOLVED (decision 21): 90 days and 200 MB per data category; masking revisited if remote access ever exists (decision 17) | M4 |
| O-8 | RESOLVED (decision 18): CLI and package name `agent-manager` | M1 |

## Security considerations (`threat-model.md`)

| Threat | How this design handles it |
|---|---|
| T-01 drive the UI/daemon from a web page or process | loopback only; app-core guard; daemon bearer token; audit log + origin marker; same-user processes can already use the socket |
| T-02 hooks block agents | async observers, short timeout, always exit 0, failures logged and surfaced; reply hooks opt-in and time-bounded |
| T-03 transcript secrets | read in place, loopback only, unmasked in v1 (decision 17); no copies except uploads |
| T-04 private socket protocol | delivery confirmed from the transcript, visible `undelivered` state, contract test and version warning in `doctor` |
| Proposed additions (lead to decide) | T-05 upload path/type abuse (magic-byte check, fixed directory, no user-controlled path segments); T-06 stale or replayed reply (message id, expiry, consume once); T-07 reply text as prompt injection into an agent (origin marker, system-reminder framing for hook transports) |
