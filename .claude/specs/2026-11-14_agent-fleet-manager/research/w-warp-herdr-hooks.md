# w-warp and herdr hooks -- what two working integrations teach us

Date: 2026-11-14. Gathered by one Explore agent reading `w-warp` scripts/logs/README and `herdr-agent-state.ps1`; the lead has not re-read the scripts.
Status: everything below is `agent report` unless marked UNVERIFIED. Paths relative to `C:\Users\Wadeck\.claude`; `W:` = `plugins\local-marketplace\plugins\w-warp`, `H:` = `hooks\herdr-agent-state.ps1`.

## Conclusion

Both integrations read very few payload fields (w-warp mostly logs; herdr reads one event), so they give limited payload truth. They do give: real event volumes, the sub-agent mis-attribution trap, a known gap in the blocked state, and what not to do in a synchronous hook (sleeps, extra spawns).

## Payload fields actually read

| Event | Fields read | Evidence |
|---|---|---|
| all (w-warp) | `session_id`, `cwd`; `agent_id`, `agent_type` (log prefix only) | `W:scripts/log.js:61-70`, `W:scripts/warp.js:75-85` |
| SessionStart | `transcript_path`, `session_id`, `cwd`, `source`; herdr also `hook_event_name`, `agent_id`, `cursor_version` | `W:on-session-start.js:21`, `H:25-26,47-51` |
| UserPromptSubmit | `prompt` (cut to 200 chars) | `W:on-prompt-submit.js:18` |
| Stop | `stop_hook_active`, `transcript_path`; last user/assistant text comes from parsing the transcript, not the payload | `W:on-stop.js:18-45` |
| Notification | `notification_type`, `message`; registered for `idle_prompt` only (log: `Claude is waiting for your input`) | `W:on-notification.js:16-17`, `W:hooks.json:27` |
| PermissionRequest | `tool_name`, `tool_input.command`, `tool_input.file_path` (else JSON of `tool_input`) | `W:on-permission-request.js:18-21` |
| PermissionDenied | `tool_name` | `W:on-permission-denied.js:16` |
| PostToolUse | `tool_name` | `W:on-post-tool-use.js:16` |
| PostToolUseFailure | `tool_name` (log only) | `W:on-post-tool-use-failure.js:11` |
| SessionEnd, StopFailure, MessageDisplay | nothing parsed, raw JSON logged | `on-session-end.js:11`, `on-stop-failure.js:11`, `on-message-display.js:11` |

UNVERIFIED: full key set of every event (w-warp log lines are cut at 180 chars); fields of SessionEnd (a `reason`?), StopFailure (error type?), MessageDisplay; Notification types other than `idle_prompt` (the 9 typed log lines are all `idle_prompt` because of the matcher); `permission_prompt` (not registered). SubagentStart/SubagentStop are used by neither integration.

## w-warp event -> state (`W:README.md:9-14`)

| Event | Sent to Warp | State |
|---|---|---|
| UserPromptSubmit | `prompt_submit` | In Progress |
| PostToolUse | `tool_complete` | working again after a permission is granted |
| Stop | `stop` | Done |
| Notification `idle_prompt` | idle | Waiting |
| PermissionRequest | `permission_request` | Permission |
| PermissionDenied | `stop` (`on-permission-denied.js:19`) | ends the blocked state |
| SessionStart | `session_start` | start |
| SessionEnd, StopFailure, PostToolUseFailure, MessageDisplay | log only | none |

Known gap (`W:README.md:113`): a manual permission deny fires no hook, so "Permission" stays until the next Stop or UserPromptSubmit.

## herdr behaviour

- Registered on SessionStart only, matcher `^(startup|resume|clear|compact|fork)$`, `powershell -NoProfile -ExecutionPolicy Bypass -File ... session`, `timeout: 10` (`settings.json:28-35`).
- Reports identity only (session id, transcript path, start source) to the pane; no working/idle state. State labels come from herdr's own screen detection (inference, UNVERIFIED).
- Skips payloads with a non-empty `agent_id` (`H:26`); reads stdin as UTF-8 explicitly (`H:13-15`).

## Sub-agents (real log counts from w-warp)

| Event carrying an `agent_id` | Count |
|---|---|
| PostToolUse | 256,104 |
| PostToolUseFailure | 2,460 |
| PermissionRequest | 591 |
| StopFailure | 29 |

- `agent_type` seen: `Explore`, `general-purpose`, `fork`; may be missing (logged `unknown`).
- Stop (17,447 runs), SessionStart, SessionEnd, Notification and UserPromptSubmit never carried an `agent_id`.
- w-warp does not skip sub-agents, so sub-agent PostToolUse/PermissionRequest events drive the main session's state: latent mis-attribution.

## Runtime, spawn cost, sleeps

| Item | Finding | Evidence |
|---|---|---|
| w-warp runtime | one `node on-*.js` process per event; no `async`, no `timeout`, no cost measurement | `W:hooks.json` |
| w-warp logging | sync file write plus directory prune on every call | `W:log.js:73-88` |
| Sleeps in a synchronous hook | 300 ms before reading the transcript in Stop; 2000 ms on resume | `W:on-stop.js:23`, `W:on-session-start.js:25` |
| Extra spawn | `claude --version` (3 s timeout) cached to `CLAUDE_ENV_FILE` at SessionStart | `W:on-session-start.js:31-40` |
| herdr runtime | PowerShell per SessionStart (cold start cost UNVERIFIED) | `settings.json:28-35` |
| `async: true` precedent | only w-guardrails SessionStart (`w-guardrails/hooks/hooks.json:11`); not a measurement | agent report |
| Volume | 256k PostToolUse events with an `agent_id` in the logs: a node spawn per event adds up (not measured) | W logs |

## Failure handling

- herdr exits 0 silently when `HERDR_ENV != 1` (`H:10`), `HERDR_PANE_ID` empty (`H:11`), `CURSOR_VERSION` set (`H:24`), `session_id` empty (`H:29`), bad JSON (`H:19-21`); the `herdr` call is in try/catch, output discarded (`H:53-55`); `HERDR_BIN_PATH` overrides the binary.
- w-warp gates on `WARP_CLI_AGENT_PROTOCOL_VERSION`/`WARP_CLIENT_VERSION` and a known-broken-release check (`warp.js:12-37`); every script ends `main().catch(... process.exit(0))`; never exits 2.
- Logs: `<cwd>/.claude/logs/w-warp/` (global fallback), daily rotation (100 files / 180 days), lines capped at 180 chars, auto-created `.gitignore`.

## Edge cases and history

- w-warp has 5 generic commits, no bug-fix commits, no tests (marketplace CLAUDE.md says "no tests").
- Lessons from other plugins: a crashing hook run from live sources locked out every session (`.claude/kb/lessons-learned.md:5-7`, wildcard-matcher warning in the marketplace `CLAUDE.md:34-46`); take timestamps inside the critical section (`lessons-learned.md:16`).
- Resume detected by `fs.existsSync(transcript_path)` (`W:on-session-start.js:22`); `stop_hook_active` guard exists but fired 0 times in the logs; `terminalSequence` output needs Claude Code 2.1.141 or later; `${CLAUDE_PLUGIN_ROOT}` works only for plugin hooks (a global hook needs an absolute path).

## Contradictions with our assumptions

| Assumption (decision) | Finding |
|---|---|
| Sub-agents come from SubagentStart/Stop (14) | Real signal is `agent_id` on PostToolUse, PostToolUseFailure, PermissionRequest, StopFailure; session-level events never carry it |
| `waiting-permission` ends on the next event (14) | A manual deny fires nothing; leave via PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop, PermissionDenied (auto-mode denials only); needs a timeout fallback |
| `waiting-user` from `idle_prompt` (14) | `idle_prompt` is a ~60 s late timer (README), not the turn end; use Stop, `idle_prompt` only refines |
| `error` from StopFailure (14) | Failure counts are high (2,460 PostToolUseFailure); failures alone must not mean error; fields UNVERIFIED |
| `ended` from SessionEnd (14) | SessionEnd payload fields unverified; keep the liveness check |
| All observers `async: true` (16) | Unproven by these integrations; async hooks cannot emit `terminalSequence`; latency/loss unmeasured |
| Node process per event is cheap (16) | w-warp does it with no measurement; PostToolUse volume suggests cost; M0 must measure |

## Copy / change list

1. Copy fail-open: wrap everything, exit 0 on bad JSON or absent daemon, gate on a reachable daemon.
2. Copy the sub-agent rule: tag every event with `agent_id`/`agent_type`; keep sub-agents out of main-session state; track them as children.
3. Change: add PermissionDenied, PostToolUseFailure, UserPromptSubmit, PostToolUse (and Stop) as exits from `waiting-permission`; document the manual-deny gap; add a timeout fallback.
4. Change: `idle`/`waiting-user` from Stop; `idle_prompt` refines; use `stop_hook_active` as a skip guard.
5. Copy: read the transcript on Stop with a short retry if not flushed (w-warp sleeps 300 ms); do it in the daemon, not the hook.
6. Change: no sleeps and no extra spawns (`claude --version`) inside hooks.
7. Copy: log raw payloads at full length for undocumented events (SessionEnd, StopFailure, MessageDisplay); the 180-char cap hid the key set.
8. Copy herdr's SessionStart matcher and `source` field to separate start from resume/compact.
9. Do not copy: wildcard matcher with a fail-closed hook; live-source editing without tests.
10. Add tests with fixtures of real payloads captured under a throwaway `HOME`.
11. Measure node cold start on Windows before committing to one process per event; consider one long-lived forwarder or an HTTP hook (availability UNVERIFIED).
