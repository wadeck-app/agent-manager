# Claude Code hooks, session registry, transcripts, local plugins

Date: 2026-11-14. Gathered by two sub-agents (local files + web docs); a few items re-read by the lead (marked [V]).
Status: mostly `agent report`. Paths: `~` = `C:\Users\Wadeck\.claude`; `W` = `~\plugins\local-marketplace\plugins\w-guardrails`.

## Conclusion

Hooks give precise live state and, in a few places, a documented way to inject text (Stop block, `asyncRewake`), but a hook cannot answer a dialog and cannot start a turn in an idle session except through `asyncRewake`. Content (tool calls, sub-agents, images) lives in the transcript JSONL, whose path is in every hook payload. A session registry at `~/.claude/sessions/<pid>.json` gives live name, cwd, status and socket path.

## Hook events and payloads

Source: https://code.claude.com/docs/en/hooks (first 100k of 293k chars read by the web agent). Parts below marked UNVERIFIED are from agent knowledge or plugin code only.

| Event | Fields / behaviour | Status |
|---|---|---|
| Common stdin | `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode`; `agent_id` / `agent_type` inside subagents (`herdr-agent-state.ps1:26` uses `agent_id`) | agent report |
| SessionStart | `source` in startup, resume, clear, compact, fork (herdr script confirms); can return `additionalContext`, stdout added as context | agent report |
| UserPromptSubmit | `prompt`; fires only on a user prompt (cannot wake an idle session); default timeout 30 s; `decision:"block"` blocks the prompt | agent report |
| PreToolUse | `tool_name`, `tool_input`, `tool_use_id` (last UNVERIFIED); output `hookSpecificOutput.permissionDecision` allow/ask/deny + reason (shape used by w-guardrails) | partly [V] in plugin code |
| PostToolUse / PostToolUseFailure | `tool_input`, `tool_response` | agent report |
| Notification | `message`, `notification_type`; matchers `permission_prompt`, `idle_prompt`, `elicitation_dialog`, `agent_needs_input`, `agent_completed`; cannot block or modify; `idle_prompt` ~60 s after Claude finishes if nothing typed and no background agent; `permission_prompt` and `elicitation_dialog` after ~6 s | agent report |
| PermissionRequest | can return `decision:{behavior:allow\|deny, updatedInput, message}`; exit code 2 not honoured; if the session cannot prompt and no hook decides, the call is denied | agent report |
| Stop / SubagentStop | input adds `last_assistant_message`, `background_tasks`, `session_crons`; `SubagentStart`/`SubagentStop` exist | agent report |
| StopFailure | reports API errors such as rate limits | agent report |
| Elicitation | questions raised by MCP servers | agent report |
| PreCompact, SessionEnd | payload fields not verified (SessionEnd probably has `reason`) | UNVERIFIED |
| Other events configured in this install | PermissionDenied, CwdChanged, WorktreeCreate, WorktreeRemove, MessageDisplay (10 s default timeout) | agent report |

## What hooks can return

| Mechanism | Detail | Status |
|---|---|---|
| Exit 2 | Stop: prevents stopping, continues the conversation, stderr is the reason; UserPromptSubmit: blocks the prompt; PreToolUse: blocks the call; Notification: ignored | agent report |
| JSON on exit 0 | `continue:false` + `stopReason` stops processing; `systemMessage` is a user-visible warning; top-level `decision:"block"` + `reason` works on UserPromptSubmit, PostToolUse, Stop, SubagentStop; `hookSpecificOutput.additionalContext` works on Stop and others, capped at 10,000 chars | agent report |
| Stop continuation | via `decision:"block"` + `reason`, exit 2 or `additionalContext`; loop guard `stop_hook_active` plus a cap of 8 consecutive continuations that resets on each tool call (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises it) | agent report; `stop_hook_active` behaviour measured in the PoC (`poc-report.md` T4) |
| Timeouts | command/http/mcp_tool default 600 s; 30 s on UserPromptSubmit; 10 s on MessageDisplay; timed-out hook output discarded and PreToolUse then proceeds; maximum allowed `timeout` UNVERIFIED; `onFailure:"block"` has no effect on Stop | agent report |
| `asyncRewake` | quote: "an `asyncRewake` hook that exits with code 2 wakes Claude immediately even when the session is idle"; stderr (or stdout if stderr empty) reaches Claude as a system reminder; timeout still enforced (plain `async` hooks are not timed); text only; plain `async` output waits for the next user interaction | agent report; idle wake and re-arm via Stop measured in the PoC |
| Dialogs | a hook cannot answer a dialog for the user; `ask` always needs a human; async hooks cannot influence the session | agent report |
| Hazard | Claude Code auto-approves `ask` for `.claude/` paths (`W\scripts\pre-tool-use.js:458-473`); `claude --print` has no TTY so `ask` would hang (w-guardrails converts to deny) | agent report |

## Session registry `~/.claude/sessions/<pid>.json`

- [V] Fields seen in `sessions/66104.json`: `pid`, `sessionId`, `cwd`, `startedAt`, `procStart`, `version` (2.1.322), `peerProtocol`, `peerFeatures` (`notify_idle`, `artifact_yield`), `kind` (`interactive`), `entrypoint`, `pidDomain`, `messagingSocketPath` (`\\.\pipe\LOCAL\cc-msg-<hash>`), `name`, `nameSource`, `nameSince`, `status` (`idle`), `updatedAt`, `statusUpdatedAt`.
- [V] 14 registry files existed at that time; `procStart` is not used by `claude-inbox.js` for liveness (see `reply-transports.md`).
- Undocumented by Anthropic per the w-agent-wake README.

## Transcripts (agent report)

| Item | Fact |
|---|---|
| Location | `~/.claude/projects/<cwd with separators turned to ->/<sessionId>.jsonl`; example `projects\C--Users-Wadeck--claude\d0b22849-...jsonl` (1033 lines) |
| Sibling folder `<sessionId>\` | `subagents\agent-<agentId>.jsonl`, `subagents\agent-<agentId>.meta.json`, `tool-results\`, `custom-title.json` |
| Line types (example file, counts) | assistant 259, user 153, api-request 89, api-request-blob 74, system 60, attachment 30, queue-operation 24, plus permission-mode, mode, custom-title, agent-name, atis-latch, last-prompt, file-history-snapshot, tools-used |
| Common fields | `parentUuid`, `uuid`, `isSidechain`, `type`, `timestamp`, `sessionId`, `cwd`, `version`, `gitBranch`, `entrypoint`, `userType` (some lines also `session_id`) |
| Assistant lines | `requestId`, `message{id, model, role, content[], stop_reason, usage}`, `effort`; content items `text`, `thinking`, `tool_use {id, name, input}` (examples: Glob, Read, `Agent` with `input{description, prompt, subagent_type}`) |
| User lines | `promptId`, `permissionMode`, `origin{kind:"human"}`, `promptSource`, `turnOrigin`, `turnPosition{promptIndex, turnIndex}`; `message.content` string or list of `tool_result` (`tool_use_id`) / `text`; top-level `toolUseResult` (shape varies by tool); `isMeta:true` marks injected lines |
| System lines | subtypes `local_command` (`commandRun`), `stop_hook_summary` (`hookInfos[{command, durationMs}]`, `hookErrors`, `hookAdditionalContext`, `preventedContinuation`, `stopReason`) |
| Attachment lines | `attachment.type` `hook_success` (hookName, hookEvent, toolUseID, exitCode, command, durationMs), `skill_listing`, `session_context`, `queued_command` |
| `queue-operation` | `enqueue`/`dequeue`; enqueued content holds `<task-notification>` text (task id, tool-use id, output file) |
| Subagents | lines in `subagents\agent-<id>.jsonl` have `isSidechain:true`, `agentId`, share the parent `sessionId`; first line `parentUuid:null`; `meta.json`: `agentType`, `description`, `toolUseId` (= parent `Agent` tool_use id), `spawnDepth`, `requestShape`, `requestNonInteractive`, `finished`; main-session lines `isSidechain:false`; whether subagent messages also appear in the main file: not checked; 12 null-`isSidechain` lines in one file not explained |
| Image shape | user line `message.content` = `[{type:"text",text}, {type:"image", source:{type:"base64", media_type:"image/png", data:"<base64>"}}]`, plus `imagePasteIds:[1]`; seen in `C--Workspace-Tooling-machine\765a1fcf-....jsonl` |
| Image size limits | UNVERIFIED |

## Existing local hooks and plugins

| Item | Facts | Status |
|---|---|---|
| Global settings hooks (`~/settings.json:15-45`) | PreToolUse(Bash) `rtk-rewrite.sh` (contents unread); SessionStart matcher `^(startup\|resume\|clear\|compact\|fork)$` runs `herdr-agent-state.ps1 session` (timeout 10); status line `node $HOME/.claude/statusline.js` | agent report |
| herdr hook | only if `HERDR_ENV=1` and `HERDR_PANE_ID` set; reads stdin, calls `pane report-agent-session` with `session_id`, `transcript_path`, `source`; skips subagents (presence of `agent_id`); runs only for SessionStart (line 25; lines 10-11, 34-52); it reports the pane-to-session mapping, not working/idle | agent report |
| w-guardrails 1.29.0 | PreToolUse `*` (sync), SessionStart (async); see protocol below | agent report |
| w-block-worktree | PreToolUse(EnterWorktree), WorktreeCreate, WorktreeRemove | agent report |
| w-command-log | PostToolUse `*`, CwdChanged | agent report |
| w-learning | SessionStart, SessionEnd, StopFailure | agent report |
| w-warp | SessionStart(startup\|resume), Stop, Notification(idle_prompt), PermissionRequest, PermissionDenied, UserPromptSubmit, PostToolUse, PostToolUseFailure, SessionEnd, StopFailure, MessageDisplay | agent report |
| w-agent-wake | mod waking an idle session; see `reply-transports.md` | [V] README |
| w-fleet | `PreToolUse` Bash guard for `_ws<N>` worktrees, opt-in via `.claude/w-fleet.json`; denies commit/merge/push on protected branches (V1-V4); README has an open TODO on long-term use. Unrelated to monitoring | [V] `w-fleet/README.md:3-26` |
| Coexistence | all matching hooks of an event run; each `ask`/`deny` is evaluated independently, so a new CLI can coexist | agent report |

## w-guardrails bypass protocol (relevant to v2)

All line numbers from `W\scripts\` (agent report).

| Step | Fact |
|---|---|
| Hook flow (`pre-tool-use.js`) | kill switch file `~\.claude\w-guardrails\DISABLED` makes every call exit 0 (lines 8-15, `kill-switch.js:19-34`), only the user can create it; fail-open on import/parse errors before the security logic (lines 70-74, 146-152), crash after `inSecurityLogic = true` (line 175) returns a deny (lines 1064-1093); screens write-capable tools, read-sensitive tools (WebFetch, WebSearch) and `mcp__*` (lines 154-162); reads `tool_name`, `tool_input.command`, `cwd`, `session_id`; collects all checker matches and picks the worst by `DECISION_RANK` (lines 102-115, 571); `ask` becomes `deny` when `CLAUDE_SUBPROCESS_NONINTERACTIVE=1` (lines 185-188) and under `.claude/` paths (lines 474-485); `ask` text capped at 7 rows of 96 chars (`ask-messages.js:5-15`) |
| Step 1 (lines 773-1027) | agent runs `node request-bypass.js --category X --mode once\|5m..24h --session <sid> --rationale "..."` without token; hook checks `--cwd`/`--session` (830-848), category (866-894), spam gate (900), writes `<project>/.claude/w-guardrails/bypass-token-<nonce>.json` (919-943, 1 h expiry) and returns a deny containing the step-2 command |
| Step 2 | agent reruns with `--token`; hook validates (976-1003), renames to `.claimed` (1007-1015), returns an `ask` dialog (`buildBypassAskMessage`, line 1018) = the user's confirmation |
| Grant | `request-bypass.js` validates token and own script path (246-258), appends to `<project>/.claude/w-guardrails/guardrails.bypass.json` (289) with lock file and atomic write (308-337); entry `{id, category, decision:'allow', session_id, mode:'once'\|'ttl', expires, reason, max_uses?, used?}` (277-286); `once` stores `max_uses`/`used` with a 1 h fail-safe TTL (135); modes `once\|5m\|10m\|15m\|30m\|1h\|2h\|4h\|8h\|24h`, 24 h cap (114-115) |
| Application (`bypass.js`, `pre-tool-use.js:488-569`) | `loadBypass` (75), `findBypass` (120, needs matching session id, category, mode, unexpired `expires`), `consumeBypass` (159); two-pass: tentative allow, rolled back if any deny remains; `_hardcoded` matches (e.g. `bypass-file-write`, `kill-switch-write`, bypass-request checks) are never bypassable; categories from `categories.js` + `CHECK_CATEGORIES` + virtual `git-commit-push` + `mcp-write:<tool>` |
| Hints and spam | deny messages carry a hint block from `bypass_hints` (`guardrails.js:525-536`); `once` hint auto-upgrades to `10m` after 2 blocks of the same category, STOP escalation after 3 (683-710); spam rule: 3 refused/ignored requests -> 30 min timeout (`bypass-state.js:6-110`, state `requests[sessionId]` `{refused_count, last_request_ts, timeout_until, block_counts}`); reset commands go through `ask` (1034-1062) |
| State files | `<project>\.claude\w-guardrails\`: `guardrails.bypass.json`, `guardrails.bypass.lock`, `bypass-state.json`, `bypass-token-*.json[.claimed]`, `session-created-files.json` (supports "own files may be removed with rm", 374, 747-764) |
| Config | `<project>\.claude\guardrails.json` (`guardrails.js:9-17`), example `W\guardrails.example.json` |
| Logs | `~\.claude\logs\w-guardrails\w-guardrails.log` (daily rotation, `log.js:13-38`), `w-guardrails-blocked-<date>.jsonl` (`log.js:99-165`), `w-guardrails-metrics-<date>.jsonl` (`log.js:171-233`); journals unread |
| v2 design issue | approval is today a human `ask` dialog in the terminal; a web UI writing grants directly would skip that confirmation. `~\.claude\statusline-bypass-lib.js` likely shows bypass state (UNVERIFIED) |

## Unverified

Payload fields of Stop, SubagentStop, PreCompact, SessionEnd, Notification; `additionalContext` and `decision:"block"` on every event; contents of `rtk-rewrite.sh`, `statusline-bypass-lib.js`, the blocked and metrics journals; whether a `PermissionRequest` hook runs in parallel with the terminal dialog.
