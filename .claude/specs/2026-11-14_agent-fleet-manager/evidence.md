# Evidence -- Agent Fleet Manager

Mark `[V]` when I re-read the source myself; otherwise `agent report`.

## app-core (agent report, unverified by me)

- Loopback-only Fastify host; module = `manifest.json` + `src/backend/index.ts` (`ctx.registerRoute`) + YAML DSL views; custom React only via `dslLib` -- `module-authoring.md:37-153`
- Registration: daemon calls `registerModule` (best-effort), `POST /api/modules/register`, file source only -- `registering-a-module.md`, `queue/.../AppCoreRegistration.ts:1-25`
- No push channel to the UI: `$sources` poll (`poll: 30s`), SSE allowed via `reply.hijack()`, no WebSocket API; spec decision 25 "No SSE/WebSocket push" -- `module-authoring.md:261-269,328-345`
- Queue pattern: module backend proxies to the daemon over IPC -- `queue/packages/app-module-queue/src/backend/client.ts`
- No auth; guard refuses cross-site non-GET and non-loopback Host -- `requestGuard.ts:51-69`
- A/B: `AbTest` YAML node or `useAbTest`; bottom-centre dock; localStorage `ab.<id>`; dev gating via `NODE_ENV` or `serve --ab-tests`; variants ship to production -- `CLAUDE.md:3-10`
- CSP: no inline style/script, no external origins -- `module-authoring.md:652-661`

## Hooks, transcripts, w-guardrails (agent report, unverified by me)

- w-guardrails 1.29.0: sync PreToolUse `*` hook, outputs `permissionDecision allow|ask|deny`; bypass = 2-step nonce protocol, grant written to `<project>/.claude/w-guardrails/guardrails.bypass.json` (`{id, category, decision, session_id, mode once|5m..24h, expires, max_uses, used}`); per-session spam gate (3 refusals -> 30 min) -- `pre-tool-use.js:773-1027`, `request-bypass.js:277-337`
- Bypass approval today is a human `ask` dialog in the terminal; a web UI writing grants directly would bypass that confirmation (v2 design issue)
- `ask` is auto-approved for `.claude/` paths and becomes deny in non-interactive subprocesses -- `pre-tool-use.js:185-188,458-485`
- Existing global hooks: `rtk-rewrite.sh` (PreToolUse Bash), a herdr SessionStart script (`herdr-agent-state.ps1`, active only if `HERDR_ENV=1`), statusline; plugins already hooking: w-guardrails, w-command-log (PostToolUse), w-learning, w-warp (Stop, Notification, PermissionRequest, UserPromptSubmit, PostToolUse, SessionEnd...), w-block-worktree; w-agent-wake and w-fleet exist (shape not parsed) -- `settings.json:15-45`
- Transcripts: `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`; sub-agents in `<sessionId>/subagents/agent-<id>.jsonl` + `.meta.json` (`agentType`, `description`, `toolUseId` = parent Agent call, `finished`); lines carry `uuid`, `parentUuid`, `isSidechain`, `agentId`; tool calls = `tool_use` in assistant content, results = `tool_result` in user content
- A hook cannot answer a dialog; async hooks cannot influence the session. Payload fields of Stop, SubagentStop, PreCompact, SessionEnd, Notification not verified

## Sibling CLIs (agent report, unverified by me)

- queue/task: TypeScript on Node >=22, npm workspaces, vitest; shared libs `shared-cli`, `shared-updater`, `singleton-daemon-kit`; family-A layout (private workspace, CI-published `@wadeck-app/<name>-cli`, esbuild CJS bundle, CalVer, `cli update|version|rollback|logs|self-check|register`) -- `shared-cli/docs/cli-best-practices.md` (partly stale)
- queue daemon: `createDaemon` from `singleton-daemon-kit`; loopback HTTP, bearer token in `<configDir>/health_token`, port in `config.port`, default 47910, idle shutdown 60 s -- `health-server.ts`, `QueueDaemon.ts`
- queue state: `~/.config/queue` NDJSON files (WAL, history 91 days, logs); module reads files directly, daemon only for actions
- queue events: `queue-sdk` publisher (never throws), `queue wait` for agents, `plugin-agent-wake` emits `agent.message` to a Claude session id -- `docs/wait.md`, `push-protocol.md`
- task: no daemon, pure service layer, `Plugin` registry built-in only; project: typed `Command` objects, no daemon
- No sibling integrates with Claude Code hooks directly; project has no CLAUDE.md or vision docs
- Plugin seams (queue `ActionPlugin`/`RelayPlugin`, task `Plugin` strategy/transport/ordering) are built-in only, no dynamic loading

## Verified by me [V]

- [V] `~/.claude/sessions/<pid>.json` is a live session registry: `sessionId`, `cwd`, `name`, `status` (seen `idle`), `kind`, `version`, `messagingSocketPath`, `updatedAt` -- read `sessions/66104.json`. Undocumented by Anthropic per w-agent-wake README
- [V] w-agent-wake README: two reply paths exist today: (1) mod waiting on queue `agent.message` (+~195 MB working set per session, mod API "still moving"); (2) experimental `scripts/claude-inbox.js` writing to the session's inbox socket (no ack, undocumented protocol, held in bypass-permissions sessions unless `crossSessionInbound: accept`, no dedup)
- [V] w-fleet = branch-protection guard for `_ws<N>` worktrees, unrelated to monitoring (README:3-26)
- [V] `agent-fleet` repo = orchestrator + headless workers launching Claude subprocesses + React web UI + `flow` CLI; it runs flows it launches, it does not monitor user-started interactive sessions -- `agent-fleet/README.md:28-44`

## Market survey (agent report, URLs not re-fetched by me)

- Four state-capture approaches: hooks/events, transcript tailing, PTY/tmux scraping, own harness/ACP. AgentAPI (PTY scraping) is archived; Vibe Kanban is sunsetting
- Closest products: Herdr (3-state pane labels, socket API), Superset/Paradev (sidebar status, chimes, mobile), Nimbalyst (needs-me queue, text/voice reply, swipe approve), agent-deck, Claude Squad, Happy (E2E relay, mobile), CloudCLI (reads ~/.claude, web UI), opcode (checkpoints)
- Claimed gaps: no documented live sub-agent tree, no uniform structured question/approval schema, no collapsed tool-call browsing documented, no cross-agent transcript normalisation, thin Windows support
- Hook docs: Notification matchers `permission_prompt`, `idle_prompt`, `elicitation_dialog`, `agent_needs_input`, `agent_completed`; `SubagentStart/Stop`; payload has `session_id`, `transcript_path`, `agent_id`/`agent_type` in subagents -- code.claude.com/docs/en/hooks (agent read first 100k of 293k chars)

## agent-fleet reuse candidates (agent report, unverified by me)

- `app-module-flow` = best template for the app-module (manifest tabs/count badges, `registerRoute`, YAML views, `views.test.ts` source/route consistency, `AppCoreRegistration.ts`)
- Log stream UI in `app-module-flow/src/dsl-components` (`LogStreamView`, `LogLine`, `foldQuietRuns`, `LogStreamChoices` A/B pattern): copy design, rename step -> turn/tool call
- Safe markdown + ANSI strip (`MarkdownText`, `SafeLinkTarget`, `AnsiStrip.ts`): copy; images are never rendered, need own allowlisted renderer
- `ToolCallTracker.ts` / `StreamJsonParser.ts` (flow-engine): pairs tool_use/tool_result; no `isSidechain` awareness; do not copy `StreamEventMapper` (reads only `content[0]`)
- `LogBuffer.ts`, `useAutoScroll.ts`: copy; `useTaskLogs` offset heuristic and fake virtualisation: do not copy
- Transport: heavy; keep ideas (state-based subscriptions, notify-then-refetch, single refresh source). Lesson: manual reload + WS reload corrupts UI (`lessons-learned.md:93-139`)
- Pitfall: never register a source checkout with the real app-core in tests (set `APP_CORE_PORT` dead, `APP_CORE_CONFIG_DIR` missing) -- `lessons-learned.md:6646-6718`
- agent-fleet has no transcript parser, reply box, image handling, sub-agent tracking or collapsed tool-call view

## w-agent-wake cost provenance

- [V] `git log` of the plugin: cost measured in `70a220f`/`a3b9993` (mod + `queue wait` path, v0.1.x); `claude-inbox.js` + contract tests added later in `a5aa1b1` (v0.2.0, latest). The 195 MB table measures the mod path only; the socket sender has no resident process and the README cost table was not updated for it
- claude-owner replied it has not examined w-agent-wake and its user told it to leave it aside; no ownership answer. Still unknown: who owns the plugin

## Terminal injection / herdr (agent report, unverified by me)

- herdr 0.9.5 installed at `~/.herdr/packages/standalone/releases/0.9.5-x86_64-pc-windows-msvc/herdr.exe`; Windows is beta; socket = named pipe, NDJSON; methods `pane.send_text`, `pane.send_keys`, `agent.prompt` (refuses when blocked), `pane.read`, `pane.list/get` (`agent_status`, `agent_session`), `events.subscribe` (`pane.agent_status_changed`) -- herdr.dev/docs/socket-api. Params of `send_text` undocumented; `herdr api schema --json` is the authority (not run)
- herdr only reaches panes run inside herdr; no clipboard image bridge for local panes; images only by path in text
- The local herdr hook reports only the pane-to-session mapping (session id + transcript path) at SessionStart, not working/idle -- `~/.claude/hooks/herdr-agent-state.ps1:10-52` (agent report)
- Claude Code image input: drag/drop, `Ctrl+V` / `Alt+V` (Windows) clipboard, or file path in prompt; pasted text > 800 chars or 3 lines collapses to `[Pasted text #N]` -- code.claude.com/docs/en/terminal-config.md, interactive-mode, common-workflows
- Happy does not inject into a TUI (spawns claude with inherited stdio, switches to SDK mode for remote); AgentAPI archived; WezTerm/tmux/Windows Terminal cannot reach already-running plain Windows console sessions; `WriteConsoleInput` discouraged by Microsoft

## Hooks / channels / socket / images (agent report; [V] where marked)

- [V] `claude-inbox.js`: `buildFrame` accepts only a non-empty string (`:116-129`); session discovery from `~/.claude/sessions/<pid>.json`, token `<pid>.<sha256(lower-cased socket path)>.key` with `peerToken` (`:85-113`); Windows refuses without the auth line (`:140-143`); socket never answers (`:131-132`)
- Hooks (agent report, docs): Stop can continue a turn via `decision:"block"`+`reason` / exit 2, loop guard `stop_hook_active` + cap of 8 continuations; command hook default timeout 600 s; `asyncRewake` hook exiting 2 "wakes Claude immediately even when the session is idle" (stderr becomes a system reminder), timeout still enforced, re-arming unverified; `idle_prompt` fires ~60 s after Claude finishes
- Channels (agent report): MCP server per session emitting `notifications/claude/channel` (string content, string-only meta); research preview, needs claude.ai/Console auth, `--channels` allowlist or `--dangerously-load-development-channels`, not on Bedrock/Vertex; memory cost not measured
- Socket protocol is private: open issues anthropics/claude-code#103048, #103123, #107175; no image evidence; docs say cross-session messaging is plain text
- Transcript image shape (agent report): user line `message.content[]` with `{type:"image", source:{type:"base64", media_type, data}}` and `imagePasteIds`
- No documented route carries image blocks into an existing interactive session; closest is a text message with an image file path that Claude reads (inference, untested)
- Remote Control is bound to Anthropic apps (no third-party UI); stream-json/SDK cannot attach to an existing interactive session

## claude-plugin-owner answers (owner report; [V] = I re-read)

- Sender is labelled experimental/unstable (`README.md:81,91`, `claude-inbox.js:6`); no latency or footprint measurement exists for a send; contract test last verified on Claude Code 2.1.319, installed now 2.1.325, not re-run (needs ~15 model turns, ~15 min)
- [V] `crossSessionInbound: "accept"` is set in user settings -- `~/.claude/settings.json:84`
- [V] Liveness = `process.kill(pid,0)` only, pid reuse undetected -- `claude-inbox.js:34-42,77`. [V] The registry JSON also holds `procStart` and `startedAt` (`sessions/66104.json`), usable to detect pid reuse (not used by the plugin)
- No test or code for image path or image block over the socket

## PoC measurements, Claude Code 2.1.325, Windows, Haiku 4.5 on Bedrock, headless `-p` stream-json (poc/results; [V] = I re-ran `poc/scripts/summarize.js` on the raw files)

- T1 socket send (agent report): wakes idle session 5/5; first stream event 325/331/446 ms; sender process 7-12 ms write (+300 ms grace), peak RSS 69 MB, transient; no resident process
- [V] T2 image by path: 3/3 correct colour through a `Read` call, turn 1990/2084/2143 ms vs text-only baseline 1524/2426 ms (n=2, noisy). Agent report: content-block array frame (1 attempt) ignored, no event in 40 s
- [V] T3 asyncRewake: wakes idle 3/3, waiter detects file 69/94/139 ms, first event 101/117/163 ms, waiter ~68 MB RSS; agent report: Stop hook of the wake turn re-arms it; at the configured timeout (20 s) the waiter dies and the session stays deaf (n=1) until the next Stop; session exit delayed ~31 s while a waiter is armed
- [V] T4 blocking Stop hook: detects file 45/170/200 ms, assistant answer 966/1286/1316 ms, `stop_hook_active` true on chained stops; agent report: expiry at 15 s then idle; the turn's `result` is delayed by the wait
- [V] T5 per-session private memory: 419 MB without waiter, 469 MB with (+43-50 MB private, +92-94 MB working set, 2 -> 6 processes); extrapolation to 10 sessions is arithmetic, not measured: ~+0.5 GB private, +40 processes
- [V] No PoC process left (`poc/scripts/alive.js`, `tasklist`); not tested: plain `async:true`, default 600 s timeout, resume/compact, 8-continuation cap, interactive (non `-p`) sessions

## Correction

- The summary figure "Read round trip 751-831 ms" (T2) is the span from the `tool_use` event to the final `result`, so it includes the second model call. Raw timeline: `tool_result` arrives 33 ms after `tool_use`. Full detail: `research/poc-report.md` (the PoC report lives there, not in `poc/REPORT.md`)

## Pending

- Four research agents running: sibling CLIs, app-core, hooks + w-guardrails, market survey. Results are `agent report` until verified.
