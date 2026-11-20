# Launching sessions from agent-manager: stream-json child, `claude --bg`, hc, own ConPTY

Date: 2026-11-19. Windows 10, Bedrock, Haiku 4.5 (3 model prompts in total, no loops, no parallel runs). `claude` was 2.1.326 at the start and auto-updated to 2.1.328 during the research (`~/.local/share/claude/versions/` lists 2.1.325, .326, .328; the stream-json runs and the first bg session ran on 2.1.326, the later bg commands on 2.1.328). Not redone: `reply-transports.md`, `permission-prompt-remote-answer.md`, `reply-wrapper-and-user-origin.md`, `hc-transport.md`.
Marks: [M] measured now, [D] official doc fetched 2026-11-19, [B] read in the installed binary (read-only scan), [R] read in a repo file, UNKNOWN.
Scripts (all in `poc/scripts/`): `launch-streamjson.mjs`, `launch-streamjson-perm.mjs`, `detach-streamjson.mjs`, `daemon-control.mjs`, `summarize-ndjson.mjs`, `ndjson-types.mjs`, `print-control-request.mjs`, `transcript-user-lines.mjs`, `bin-grep.mjs`, `bin-slice.mjs`, `list-trusted.mjs`. Raw logs: `%TEMP%\am-research3\{A,A2}.ndjson` (not in the repo).

## Conclusion

1. "Headless does not stay open" is wrong for `--input-format stream-json`: the process stayed open across two messages 8 s apart, and ended 72 ms after stdin was closed [M]. It does not survive its owner: when the parent exited without closing the pipe, the child was dead within 6 s [M]. So it needs a long-lived owner (the agent-manager daemon); a daemon restart ends every such session (resumable by id, recovery of an in-flight turn UNKNOWN).
2. stream-json gives the only fully structured channel, all proven here: user message with a client `uuid` and delivery events, image content blocks (answered "magenta"), permission request as a JSON object and allow/deny answered as JSON (one allowed, one denied, in one turn) [M]. No terminal rendering is involved.
3. `claude --bg` is real, first-party, works on this Bedrock machine, and survives terminal and manager (the supervisor owns the sessions), but it exposes NO structured event or answer API: state via `claude agents --json`, text via `claude logs` (ANSI screen dump), replies via a private supervisor pipe, permission prompts only by `attach` (a terminal) [D][M].
4. A stream-json session can be handed to a terminal afterwards: `claude --resume <id> --bg` (after the process ended) re-opened it under the same session id with the full transcript [M]. It re-applies the user's default model and mode (Sonnet 5.5, auto) rather than the launch flags [M].
5. agent-fleet / flow do NOT keep Claude open: one-shot `-p`, prompt on stdin then `end()`, no permission host [R]. The only kept-open prior art is a PoC in `poc-agent-wake` [R].

## What agent-fleet already does [R]

| Question | Answer (`C:\Workspace_Tooling\agent-fleet\packages\flow-engine\src\processing\ClaudeLauncher.ts` unless noted) |
|---|---|
| argv | `[mcp-config] [--settings f --include-hook-events] [--dangerously-skip-permissions] [--tools] --output-format stream-json --verbose [--model] [--autocompact auto] [--resume id] -p` (`buildCommand`, :196-290; `--verbose` required with stream-json, :252) |
| stdin | the prompt as raw text, then `stdin.end()` (:403-407): one prompt per process, NOT `--input-format stream-json` |
| permissions | none: only `--dangerously-skip-permissions` opt-in (:216,241); no `--permission-prompt-tool`, no `control_request`, no `can_use_tool` anywhere in `agent-fleet/packages/**/src` (grep) |
| events | NDJSON parsed by `StreamJsonParser.ts` and mapped by `StreamEventMapper.ts`; end of turn = the `result` event |
| finished / stuck | after `result` it waits `DEFAULT_RESULT_GRACE_MS = 30_000` (:20) then `killTree(pid,'SIGKILL')` and closes the pipes (:428-455), because a background task can keep the CLI alive |
| env | allow-list when sandboxed (PATH, HOME, SystemRoot, USERPROFILE, plus step env), else full env (:305-325) |
| interactive mode | `stdio:'inherit'`, prompt as positional arg (:326-345): the user's terminal, nothing captured |
| restart | none: a step is re-run, `--resume <id>` only when a flow asks for it (:275) |
| other repo | `C:\Workspace_Tooling\poc-agent-wake\test\e2e-interrupt.js:25-51,99`: `claude -p --input-format stream-json --output-format stream-json --verbose --plugin-dir ... --allowedTools ...`, stdin lines `{type:'user',message:{role:'user',content}}`, `stdin.end()` to finish; permissions avoided with `--allowedTools` |

What differs for agent-manager: a long-lived multi-turn process, a permission host (agent-fleet has none), images, takeover by a human, restart recovery, and a UI that shows events live.

## Experiment A: stream-json child, 2 messages and an image (2 prompts)

Command (run from `poc/`): `node scripts/launch-streamjson.mjs <TEMP>\am-research3\projA <TEMP>\am-research3\A.ndjson`. Spawned argv: `claude -p --input-format stream-json --output-format stream-json --verbose --replay-user-messages --model haiku --session-id 7b0f6378-600e-4596-bc3c-cfef5f4c6508 --setting-sources project --permission-mode default`, cwd `%TEMP%\am-research3\projA`, stdio piped, `windowsHide`, env inherited (Bedrock).

Lines sent on stdin (one JSON object per line, base64 elided):

```
{"type":"user","uuid":"0c804a80-64fc-4bcf-9d26-fcc1d046b51c","message":{"role":"user","content":[{"type":"text","text":"Reply with the word PONG1 and the main colour of the attached image in one word. No tools."},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"<base64 of poc/fixtures/magenta-64.png>"}}]}}
{"type":"user","uuid":"1ed851eb-24fc-474d-b9c4-99f673fe41bb","message":{"role":"user","content":"Run exactly this Bash command and nothing else: touch am-streamjson-file.txt . Then reply DONE2."}}
```

Timeline (ms since spawn):

| t | Event |
|---|---|
| 4014 | process alive; registry file `~/.claude/sessions/29932.json` ABSENT; no stdout line at all (no `init` before the first message) |
| 4585 | message 1 sent |
| 4601 / 4607 | `{"type":"command_lifecycle","command_uuid":"0c804a80-...","state":"queued"}` then `"state":"started"` (16 and 22 ms after the send) |
| 4723 | `{"type":"system","subtype":"init","cwd":...,"session_id":...,"tools":[...]}` |
| 12385-13654 | 99 `{"type":"system","subtype":"thinking_tokens","estimated_tokens":N,"user_message_uuid":"0c804a80-..."}` |
| 13655 | replay: `{"type":"user","message":{...},"session_id":...,"parent_tool_use_id":null,"uuid":"0c804a80-...","timestamp":"2026-11-19T19:17:42.922Z","isReplay":true}` (arrives with the first assistant line, NOT on receipt) |
| 13766 | `{"type":"assistant","message":{"model":"anthropic.claude-haiku-4-5-20251001-v1:0",...,"content":[{"type":"text","text":"PONG1 magenta"}]}}` |
| 13781 | `{"type":"result","subtype":"success","stop_reason":"end_turn","total_cost_usd":0.0327475,...}` |
| 14065 | `command_lifecycle ... "state":"completed"` |
| 22070 | 8 s pause over, process still alive; message 2 sent |
| 22080-22093 | `command_lifecycle queued`, `started`, a second `system/init` (init is emitted per turn) |
| 23244-23331 | assistant `tool_use` Bash `touch am-streamjson-file.txt` |
| 23378 | `{"type":"system","subtype":"permission_denied","tool_name":"Bash","tool_use_id":"toolu_...","message":"touch in '...' needs approval. The path is inside the working directories ..."}` (NO control_request: with no host the call is denied automatically) |
| 24388 | `result` (success); stdin closed by the script |
| 24460 | exit code 0 (72 ms after the close) |

Registry file while alive (written lazily, between 4.0 s and the first result; same file at the end):

```
{"pid":29932,"sessionId":"7b0f6378-...","cwd":"...\\am-research3\\projA","startedAt":1795115862609,"procStart":"134395894582586670","version":"2.1.326","peerProtocol":1,"peerFeatures":["notify_idle","artifact_yield"],"kind":"interactive","entrypoint":"sdk-cli","pidDomain":"win32:midgard2","messagingSocketPath":"\\\\.\\pipe\\LOCAL\\cc-msg-6b123a74...","name":"proja-24","nameSource":"derived","status":"busy",...}
```

So agent-manager's registry reader would see it as `kind:"interactive"`, `entrypoint:"sdk-cli"`, with a socket path (no new kind to handle). The file has `status:"busy"` at both snapshots (taken at the `result` line): whether it flips to idle afterwards: UNKNOWN.

Transcript (`~/.claude/projects/...projA/7b0f6378-....jsonl`, via `transcript-user-lines.mjs`): `queue-operation enqueue` / `dequeue`, then `{"type":"user","promptSource":"sdk","turnOrigin":"sdk","entrypoint":"sdk-cli"}` with the image block as base64 and a second `isMeta` line `[Image: source: C:\Users\Wadeck\AppData\Local\Temp\claude\<hash>\7b0f6378-...\images\1.png]`. There is NO `origin` field (neither `human` nor `peer`), no wrapper text; the model answered normally. How the auto-mode classifier treats `promptSource:"sdk"`: UNKNOWN.

Memory, idle fresh Haiku session [M]: before the first message `claude.exe` WS 179 MB / private 409 MB plus a child `conhost.exe` 12.9 MB WS (so 2 processes even with `windowsHide`); after one turn 206 MB / 447 MB.

### A2: permission host (1 prompt)

Command: `node scripts/launch-streamjson-perm.mjs <TEMP>\am-research3\projA2 <TEMP>\am-research3\A2.ndjson`. Same argv plus `--permission-prompt-tool stdio` (value `stdio` found in the binary: string `--permission-prompt-tool=stdio` at offset 175125536 of 2.1.326, option text "MCP tool to use for permission prompts (only works with --print)" at 164973430; it is absent from `claude --help`). Message sent: "Run two Bash commands, each in its own separate tool call ... first `touch am-allow.txt`, then `touch am-deny.txt`. If one is refused, do not retry it. Then reply DONE."

Received (full, no secrets):

```
{"type":"control_request","request_id":"8847a95f-2028-4a23-9949-31bb313907b4","request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash","input":{"command":"touch am-allow.txt","description":"Create file am-allow.txt"},"description":"Create file am-allow.txt","permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"touch am-allow.txt"}],"behavior":"allow","destination":"localSettings"},{"type":"addDirectories","directories":["C:\\...\\projA2"],"destination":"session"},{"type":"setMode","mode":"acceptEdits","destination":"session"}],"blocked_path":"C:\\...\\projA2\\am-allow.txt","tool_use_id":"toolu_bdrk_012zixpr4Hr4MWujN8J5ErDb"}}
```

Sent (allow, 0 ms after the request; then deny for the second request `23c276ed-...`):

```
{"type":"control_response","response":{"subtype":"success","request_id":"8847a95f-...","response":{"behavior":"allow","updatedInput":{"command":"touch am-allow.txt","description":"Create file am-allow.txt"}}}}
{"type":"control_response","response":{"subtype":"success","request_id":"23c276ed-...","response":{"behavior":"deny","message":"Denied by the agent-manager research host."}}}
```

Result: `am-allow.txt` created, `am-deny.txt` not; the deny came back as `tool_result` `is_error:true` with the message and `tool_result_meta ... "permission_decision":{"decision":"reject","source":"user_reject"}`; the model replied `DONE`; each answer was echoed back on stdout as a `control_response` line; total 8.8 s, exit 0 after the close. Same shape as the SDK `canUseTool` result [D] (`user-input.md`: `{behavior:"allow",updatedInput}` / `{behavior:"deny",message}`). `permission_suggestions` can be echoed in `updatedPermissions` to persist a rule (doc); not run here.

Other inbound control subtypes present in the 2.1.328 binary (names only, NOT run): `initialize`, `interrupt` (a variant carries `cancel_queued`), `set_permission_mode`, `set_model`, `mcp_status`, `get_context_usage`, `get_usage`, `stop_task`, `cancel_async_message`, `rewind_files`. Interrupt, mode switch and `cancel_async_message` frame shapes: UNKNOWN until run (one prompt each).

Flags and docs [D] (`headless.md`): `--permission-prompts none` denies instead of asking; `-p` shows NO workspace trust dialog and runs the project's hooks and `.mcp.json` servers even in an untrusted folder (use `--setting-sources` or `--bare` knowingly); SIGTERM exits 143 without recording the turn, closing stdin cancels a pending permission prompt; background tasks can keep a `-p` run open after the result (10 min default cap, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`); with Bedrock, `--bare` still reads provider credentials.

### A3: detach (no model call)

`node scripts/detach-streamjson.mjs spawn <TEMP>\am-research3\projA3` (child `detached:true`, piped stdio, `unref`, parent exits after 1.5 s without closing stdin), then `check <pid>` 6 s and 12 s later: `pid 35312 alive=false` both times [M]. Cause (stdin EOF) is inferred, stderr was not captured. No documented way to give `claude -p` a stdin that outlives its parent on Windows: UNKNOWN (a named pipe or file as stdin was not tried).

### A4: takeover after the process ended (no model call)

`claude --resume 92af01ad-... --bg --name am-resumed` from `%TEMP%\am-research3\projA2`: `Workspace not trusted. Run `claude` in <dir> once and accept the trust prompt, then retry.` exit 1 [M] (docs: since v2.1.281 `--bg` checks trust, a script gets this error [D]). From the trusted scratch folder `%TEMP%\am-research2\proj`: `backgrounded - 92af01ad - am-resumed (idle - send a prompt to start)`; `claude logs 92af01ad` shows the whole earlier conversation including the denied call, header `Claude Code v2.1.328 / Sonnet 5.5 / Amazon Bedrock`, footer `auto mode on` [M]. A plain interactive `claude --resume <id>` and `attach` were not run (need a terminal): UNKNOWN. Docs [D]: opening a stopped session already resumed elsewhere is refused ("Can't open - this session is running in another terminal").

## Experiment B: `claude --bg` (0 model prompts)

A session started with no prompt stays idle without a model call (`backgrounded - 284b31e9 - am-bg-probe (idle - send a prompt to start)`), so everything below cost nothing. The daemon was NOT running before (`claude daemon status`: "not running", roster 81 days old), so the supervisor was mine.

Commands (cwd `%TEMP%\am-research2\proj`, a folder already trusted in `~/.claude.json`): `claude --bg --model haiku --name am-bg-probe` (exit 0, 1 s, "Starting background service..."), `claude agents --json --cwd <dir>`, `claude logs 284b31e9`, `claude stop`, `claude rm`.

| Item | Observed [M] |
|---|---|
| Supervisor | `claude.exe daemon run --origin transient --spawned-by {"label":"claude --bg",...}` (pid 22624 then 35904 after the auto-update); `claude daemon --help`: "Service install is disabled in this version - the daemon runs on demand and exits once no client is connected and no background session is running"; it exited by itself 5 s after the last session was removed (daemon.log "idle 5s with no clients - exiting") |
| Per session | `claude.exe --bg-pty-host \\.\pipe\cc-daemon-<16hex>-pty-<short> 200 50 -- claude.exe --session-id ... --model haiku --name ...` (host process, WS 80-83 MB / private 148-162 MB) which owns the real `claude.exe` (WS 259-271 MB / private 551-585 MB) and a `conhost.exe --headless` (7 MB): a ConPTY-hosted TUI, 3 processes per session plus one shared supervisor (WS 111-120 MB / private 334-341 MB) |
| Registry | `~/.claude/sessions/23324.json`: `"kind":"bg","entrypoint":"cli","jobId":"284b31e9","messagingSocketPath":"\\\\.\\pipe\\LOCAL\\cc-msg-257adc8a...","name":"am-bg-probe","nameSource":"peer","version":"2.1.326","status":"idle"`, plus `.key` file for the inbox token (same layout as interactive sessions) |
| Job state | `~/.claude/jobs/284b31e9/state.json`: `state, detail, tempo:"blocked", needs:"send a prompt to start", name, sessionId, cwd, template:"bg", respawnFlags[--name,--model,--permission-mode default], providerEnv{CLAUDE_CODE_USE_BEDROCK,AWS_PROFILE,...}, backend:"daemon"`; docs: "not a stable interface" [D] |
| `claude agents --json` | `[{"pid":23324,"id":"284b31e9","cwd":"...","kind":"background","startedAt":1795116092946,"sessionId":"284b31e9-0a0c-4ca1-ade2-8c130b3a0cd3","name":"am-bg-probe","status":"idle","state":"blocked"}]` (also lists interactive sessions when no `--cwd`). Documented fields [D]: `cwd, kind, startedAt` always; `id, state` (`working|blocked|done|failed|stopped`) for bg; `pid, status` (`busy|waiting|idle`) while alive; `waitingFor` (`permission prompt`, `input needed`, `sandbox request`, `worker request`, `dialog open`) when `status` is `waiting`; `sessionId, name`; `--all` adds completed ones. Not observed: `waitingFor` (no turn run) |
| `claude logs <id>` | an ANSI screen dump (cursor codes, the TUI frames repeated), not structured text |
| Survive terminal | by design [D]: "A separate supervisor process runs them, so you can close agent view, close your shell..."; machine shutdown stops them; finished or waiting sessions unattached for about an hour are stopped and restarted on attach [D] |
| Survive manager restart | the manager is only a client. When the CLI auto-updated mid-research the supervisor was replaced and `list` showed my session as `"state":"adopted","detail":"adopted from previous supervisor"` with the same worker pid, still running |
| Provider | `claude logs` header "Haiku 4.5 - Amazon Bedrock"; supervisor log "auth: 3P provider active, skipping OAuth refresh loop" and, on 2026-08-30 (2.1.251), `bg settled a2053766 (done)` after a normal run in `~/.claude/daemon.log`: bg sessions run on this Bedrock machine. A model turn inside a bg session in 2.1.326 was NOT run (no prompt left): UNKNOWN. Docs name Bedrock only for summaries and provider env forwarding; no support or exclusion statement found in the 146k chars read |
| Doc status | "Agent view is in research preview. The interface and keyboard shortcuts may change" [D] (`agent-view.md`; version table up to v2.1.323, no dates); disable with `disableAgentView` or `CLAUDE_CODE_DISABLE_AGENT_VIEW` [D] |

### How a program talks to a bg session

| Route | Result |
|---|---|
| Documented CLI send | none: the docs list `--bg`, `agents`, `attach`, `logs`, `stop`, `respawn`, `rm`; the peek-panel reply is interactive only [D]. `claude --resume <id> --bg "prompt"` continues a STOPPED session with a prompt (a copy when running) [D][M for the resume part] |
| Supervisor control pipe (private) | `\\.\pipe\cc-daemon-<16hex>-control`, NDJSON, auth = contents of `~/.claude/daemon/control.key`. Found by reading the binary (`op:"reply"` at offset 331678302 of 2.1.326). Sent `{"proto":1,"op":"ping"}` -> `{"ok":true,"op":"ping","version":"2.1.328","proto":1,"carriedPromptsFormat":1,"signInPinFormat":1}`; `{"proto":1,"op":"list","auth":"<key>"}` -> `{"ok":true,"op":"list","jobs":[{"short":"284b31e9","sessionId":...,"pid":15880,"state":"adopted",...}]}`; `{"proto":1,"op":"reply","short":"284b31e9","text":"/rename am-bg-probe2","auth":"<key>"}` -> `{"ok":true,"op":"reply"}`. Effect: registry `name` became `am-bg-probe2`; the transcript got `{"type":"queue-operation","operation":"enqueue","content":"/rename am-bg-probe2"}`, then `system/local_command` "Session renamed to: am-bg-probe2" [M] |
| What that proves | the reply is TYPED input (a slash command ran), through the same `queue-operation enqueue` as the typed path seen with `hc send`; it does not prove the origin of a plain prompt (no model turn): UNKNOWN. Docs: replying does not answer a permission dialog, the message waits in the queue [D] |
| Inbox socket (`messagingSocketPath`) | exists in the registry; same private frames as `reply-transports.md`; peer wrapping not re-tested on a bg session: UNKNOWN (expected the same, see `reply-wrapper-and-user-origin.md`) |
| Answer a permission prompt | only by `attach` (a terminal) [D]. A program could try the per-session `ptySock` named pipe or a `PermissionRequest` hook (proven interactive in `permission-prompt-remote-answer.md`, not tried on bg): UNKNOWN. The pty pipe protocol was not read |
| Images | UNKNOWN (reply is text; path in text expected) |
| Delivery signals | `{"ok":true,"op":"reply"}`, transcript `queue-operation`, job `state` / `waitingFor` in `agents --json` |

Risk: `control.key` is a plain file readable by any process of the user, same exposure class as the `hc` pipe (`permission-prompt-remote-answer.md`, "Existing exposure"); the protocol is private (`proto` 1, no doc).

## Comparison

Per option: what the web UI gets. "Structured" means events and answers as data, not screen text.

| Aspect | 1. stream-json child (daemon owns it) | 2. `claude --bg` | 3. `hc run` (herdr-core) | 4. own ConPTY (node-pty) |
|---|---|---|---|---|
| Stays open | yes while stdin is open [M]; ends with its owner [M] | yes, supervisor-owned [D][M] | yes, host-owned [R: prior docs] | yes while the wrapper lives |
| Structured events | best: NDJSON init, assistant, user replay, result, `command_lifecycle`, `permission_denied`, `thinking_tokens` [M] | none live: transcript, registry, `agents --json` (state, waitingFor), logs are ANSI [M][D] | none: transcript + `hc get` status; screen via `hc read` | none: you parse the screen |
| Typed-as-user | `promptSource:"sdk"`, no `origin`, no wrapper, model answered normally [M]; classifier treatment UNKNOWN | reply op typed a slash command [M]; origin of a prompt UNKNOWN | proven human (`hc send`) [reply-wrapper doc] | typed (you write the keys) |
| Permission answer | structured: `control_request`/`control_response` allow, deny, updatedInput, suggestions [M] | attach only [D]; hook or pty pipe UNKNOWN | `hc keys` (proven), choose keys from a screen read | write keys, same as hc |
| Images | base64 content block [M] | UNKNOWN (path in text) | path in text | path in text |
| Interrupt | `interrupt` frame exists [B], not run | not run; attach + Esc | `hc interrupt` (documented, not run) | write Esc |
| Delivery confirmation | `command_lifecycle` queued/started/completed 16/22 ms after send [M]; replay line only with the turn [M] | `{"ok":true,"op":"reply"}` + transcript `queue-operation` [M] | `send` result `{started,turn,status}` [reply-wrapper doc] | none by design |
| Human takeover | only after the process ended: `claude --resume <id> --bg` then attach (resume proven, attach untested) [M]; model/mode reset to defaults [M] | `claude attach <id>` (terminal) [D] | the user's own herdr terminal | a terminal you render yourself |
| Survives manager restart | no (dead within 6 s of the parent exit) [M]; resume by id, in-flight turn and pending permission lost (UNKNOWN) | yes [D][M] | yes | no |
| Processes / memory per idle session | 2 (claude + conhost): WS 179-206 MB, private 409-447 MB [M] | 3 (+ shared supervisor): WS 259 + 80 + 7 = ~346 MB, private ~700 MB, supervisor ~111 MB shared [M] | claude + powershell + one OpenConsole (~8 MB WS each seen under herdr-core); the user's loaded sessions show 240-340 MB WS [M, not comparable to a fresh session] | claude + node host + conhost: not measured |
| Windows | proven [M] | proven [M] | proven (earlier docs) | UNKNOWN here (needs node-pty, nothing installed); herdr bundles its own ConPTY [reply-transports.md] |
| Third party | none | none (first-party, research preview) | herdr-core / hc 0.1.21 | node-pty native module |
| Other limits | `-p` skips the trust dialog and runs project hooks/MCP [D]; background tasks can hold the run after `result` [D] | trust must be accepted beforehand else `Workspace not trusted` [M]; idle sessions stopped after about 1 h [D]; research preview, private control pipe | alpha CLI; screen-based | reimplements `--bg-pty-host`, key and resize relay |

## Ranking and recommendation

For "agent-manager launches sessions itself" with a web UI that needs structured log, composer, approve/deny and images:

1. stream-json child owned by the daemon: the only option where every UI action is a JSON object and every outcome is an event, all proven on Windows/Bedrock. The cost is that the daemon is a single point of failure. Recommend it as the launch mode, with: one process per session, client `uuid` on every message (match `command_lifecycle.command_uuid`), allow-once / deny only through `control_response` (never echo `permission_suggestions`), `--permission-prompts` left at the default (host) so a prompt can never be denied silently, daemon restart = `--resume <id>` of each session it owned, and "Open in terminal" = close stdin, then `claude --resume <id> --bg` and `claude attach` (the attach step is untested).
2. `claude --bg`: choose it instead if surviving a manager restart matters more than structured answers. It adds nothing structured, answers prompts only with a terminal, and its control pipe is private. Its registry entry fits the current reader unchanged (`kind:"bg"`).
3. `hc run`: already the transport for sessions started by the user in herdr; keep it for those (typed human prompt, `hc keys`). As a launcher it adds a third-party dependency for no structured gain.
4. Own ConPTY: not recommended, `--bg` already ships a pty host and nothing proves node-pty here.

Unproven, in priority order: (a) resume-after-kill of a stream-json session with a pending permission or turn; (b) `interrupt`, `set_permission_mode` frames; (c) hours-long idle stream-json process and 10 concurrent sessions (needs your approval, not run); (d) `claude attach` on a resumed session and plain interactive `claude --resume`; (e) a model turn and a permission prompt inside a bg session on 2.1.328 over Bedrock, and the peer/human origin of a bg reply; (f) whether registry `status` returns to `idle` for a stream-json session; (g) stdin that outlives the parent on Windows; (h) node-pty feasibility; (i) the auto-mode classifier treatment of `promptSource:"sdk"`.

## Clean-up and leftovers

Stopped and removed with `claude stop` / `claude rm`: bg sessions `284b31e9`, `92af01ad`; the transient supervisor exited by itself (`claude daemon status`: not running); the detached stream-json child died alone (pid 35312); no process of mine remains (CIM search on `am-research`, `bg-pty-host`, `daemon run`). Left on disk: `%TEMP%\am-research3\` (logs, `projA`, `projA2` with `am-allow.txt`, `projA3`), `%TEMP%\am-research2\proj` (recreated empty; its trust entry in `~/.claude.json` pre-existed), four scratch transcripts under `~/.claude/projects/` (`...am-research3-projA`, `...projA2`, `...projA3`, `...am-research2-proj`), `~/.claude/daemon/` files and a few lines in `~/.claude/daemon.log`, the new scripts above in `poc/scripts/`. `~/.claude/jobs/<id>` of the two sessions is gone after `rm`. Nothing committed, nothing installed. Total model prompts: 3 (A msg 1 with image, A msg 2, A2).

## Round 2 (docs + PoCs)

Date: 2026-11-19, `claude` 2.1.328, Haiku 4.5 on Bedrock. Marks as above. Script: `poc/scripts/ctl-test.mjs` (subcommands `interrupt`, `setmode`, `survive-parent`, `watch`, `resume-turn`, `resume-perm`). Logs: `%TEMP%\am-research4\*.ndjson` (not in the repo). About 16 Haiku turns, one session at a time, no loops.

### Part A: what the official docs say [D]

Verdict: "undocumented" was too strong. The raw wire protocol is not documented as such, but the flags, the concepts and parts of the control envelope are. Binary-only (not found in the pages fetched): the value `stdio` of `--permission-prompt-tool`, the `can_use_tool` request body, and the exact `set_permission_mode` / `set_model` / `interrupt` request frames (the docs show them only as SDK methods).

Pages fetched: `cli-reference`, `headless`, `agent-sdk/streaming-vs-single-mode`, `agent-sdk/permissions`, `agent-sdk/user-input`, `agent-sdk/typescript` (all 335k chars), `errors` (first 100k of 640k chars only), `llms.txt`. Base URL `https://code.claude.com/docs/en/`. The `cli-reference` page was searched by grep on the saved text.

| Question | Doc finding |
|---|---|
| `--permission-prompt-tool` | Documented, but as an MCP tool, not `stdio`. `cli-reference`: "Specify an MCP tool to handle permission prompts in non-interactive mode. Pass the full name, such as `mcp__<server>__<tool>`, of a tool on an MCP server that the run loads." Example `--permission-prompt-tool mcp__permissions__approve`. The value `stdio` appears in none of the pages above, so `stdio` = [B] only. |
| `--permission-prompts` | `cli-reference`: "With the default `host`, Claude Code sends them to the Agent SDK host or the `--permission-prompt-tool` tool. Pass `none` when nobody can answer, and Claude Code denies them instead." |
| `--input-format stream-json` | `cli-reference`: "`--input-format` Specify input format for print mode (options: `text`, `stream-json`)"; `--replay-user-messages`: "Re-emit user messages from stdin back on stdout for acknowledgment. Requires `--input-format stream-json` and `--output-format stream-json`"; `--max-turns`: "With `--input-format stream-json`, a message still queued when the limit ends a turn stays queued and starts a new turn with its own limit". The message shape is documented only as the SDK type `SDKUserMessage` (`type:"user"`, `message:{role,content}`, `parent_tool_use_id:null`, optional `priority:"now"`, optional `origin:{kind:"human"}`; `typescript`), and `streaming-vs-single-mode`: "Streaming input keeps an Agent SDK session open so your application can send it more than one message while it runs." |
| `control_request` envelope | Partly. `typescript` (`SDKControlInitializeResponse`): "Each entry is a complete `control_request` message with the same `{ type: "control_request", request_id, request }` shape the session streams for permission requests while running." `CanUseTool.requestId`: "The `control_request` envelope's `request_id`. A `control_response` your application sends outside the SDK ... must echo this value so the Claude Code process can match the reply to the request"; "permission prompts don't time out". |
| `can_use_tool` | The string appears once (`SDKPermissionDeniedMessage.agent_id`: "Mirrors the field on `can_use_tool` for host-side routing"). Documented as the SDK callback `canUseTool` returning `{behavior:"allow",updatedInput?,updatedPermissions?}` or `{behavior:"deny",message,interrupt?}` (`user-input`, `typescript` `PermissionResult`): the payload I sent in round 1, without the `control_response` wrapper. |
| `interrupt` | `streaming-vs-single-mode`: "When you call `interrupt()` during a response, that response ends with an `error_during_execution` result. Messages you sent before the interrupt that Claude hadn't read yet still reach Claude once the interrupted response ends." `typescript`: `SDKControlInterruptResponse = { still_queued: string[]; cancelled?: string[] }`; "A client that drives the CLI's control protocol directly, rather than through `interrupt()`, can set `cancel_queued: true` on the `interrupt` control request."; capabilities `interrupt_receipt_v1` and `interrupt_cancel_queued_v1` (v2.1.219+) in `system/init`. |
| `set_permission_mode`, `set_model` | SDK methods only. `permissions`: "Call `set_permission_mode()` (Python) or `setPermissionMode()` (TypeScript) to change the mode mid-session. The new mode takes effect immediately for all subsequent tool requests." `typescript`: "`setModel()` Changes the model (only available in streaming input mode)". Wire name `set_model` appears once, in a hook comment. No JSON frame documented. |
| `initialize` | `typescript`: the `initialize` response "also carries a `pending_permission_requests` array"; a repeated `initialize` "such as with `reinitialize()` after a transport gap" is followed by a `background_tasks_changed` snapshot, so "A reconnecting host therefore learns what is running". |
| Process lifetime, stdin close | `headless`: "After Claude finishes its turn and stdin has closed, a `claude -p` run can stay open to wait for background work" (10 min cap); "If your program closes the session through the Agent SDK, the SDK ends Claude Code's input before sending any signal, and Claude Code cancels the prompt as soon as the input ends."; SIGTERM: exit 143, turn left unfinished, no result recorded. Resume: "Claude Code leaves the interrupted turn as it is, and your next prompt drives the conversation. To have Claude Code continue the interrupted turn on resume instead, set `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`." Nothing about the parent dying. |
| Session state events | `typescript`: with `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`, `{type:"system",subtype:"session_state_changed",state:"idle"\|"running"\|"requires_action"}` (not run). |
| Wire-protocol page | none: `llms.txt` has no page on the stream-json protocol. |

New from the docs: `SDKUserMessage.origin` exists (`{ kind: "human" }` in the doc example). My round-1 messages carried no `origin`; whether `origin:{kind:"human"}` changes the transcript or the auto-mode treatment: not run, UNKNOWN.

### Part B

#### B1: `interrupt` [M]

Frame (nothing else in it): `{"type":"control_request","request_id":"9a163958-...","request":{"subtype":"interrupt"}}`. Run: `node scripts/ctl-test.mjs interrupt`; argv `claude -p --input-format stream-json --output-format stream-json --verbose --replay-user-messages --model haiku --setting-sources project --permission-mode default --include-partial-messages --session-id <uuid>`. Prompt: "Count from 1 to 3000, one number per line. No tools, no commentary." Interrupt sent 1.5 s after the first `text_delta` (118 stream events received). Events (ms since spawn):

```
 6373 SEND interrupt
 6376 control_response {"subtype":"success","request_id":"9a163958-...","response":{"still_queued":[]}}
 6377 assistant text "1\n2\n...26\n2"   (partial text, flushed)
 6380 user [{"type":"text","text":"[Request interrupted by user]"}]
 6383 result/error_during_execution stop_reason=null is_error=true terminal_reason=aborted_streaming
      command_lifecycle state=cancelled (in the log, after the result)
 7950 SEND user "Reply with exactly: PONG2" -> queued, started, init, assistant "PONG2", result/success, completed
```

Verdict: PROVEN. The turn stopped 10 ms after the frame (3 more stream events), the receipt is `{still_queued:[]}` as in the doc type, the process stayed alive and answered the next message normally, exit 0 after the stdin close. Transcript: partial assistant text, a `user` line `[Request interrupted by user]`, then the next turn. Side findings, from the two earlier runs of the same script: (1) an interrupt sent after the turn had already ended (Haiku counts to 200 in about 3 s) returns the same `still_queued:[]` success and nothing else happens; (2) an interrupt sent while the request was still in the `requesting` state (no delta yet, that request stalled 46 s) also worked: `control_response`, replay of the user message, `[Request interrupted by user]`, `result/error_during_execution`, `command_lifecycle cancelled`, next message completed; (3) `command_lifecycle` has a `cancelled` state, absent from round 1. `cancel_queued` not run.

#### B2: `set_permission_mode` [M]

Run: `node scripts/ctl-test.mjs setmode` (argv as above plus `--permission-prompt-tool stdio`, started in `--permission-mode default`).

```
SEND {"type":"control_request","request_id":"121e43d8-...","request":{"subtype":"set_permission_mode","mode":"acceptEdits"}}
RECV {"type":"control_response","response":{"subtype":"success","request_id":"121e43d8-...","response":{"mode":"acceptEdits"}}}   (720 ms, before any user message)
SEND user: Run exactly this Bash command and nothing else: touch am-mode1.txt . Then reply DONE1.
RECV assistant tool_use Bash "touch am-mode1.txt" -> tool_result is_error=false -> "DONE1"   (NO control_request; am-mode1.txt exists)
SEND {... "request":{"subtype":"set_permission_mode","mode":"default"}} -> RECV response {"mode":"default"} (2 ms)
SEND user: ... touch am-mode2.txt . If refused, do not retry. Then reply DONE2.
RECV control_request can_use_tool Bash "touch am-mode2.txt" -> I denied -> tool_result is_error=true; am-mode2.txt absent
```

Verdict: PROVEN in both directions; the effect is the absence, then the presence, of a `can_use_tool` request for the same kind of call. The response echoes the new mode. The registry file has no permission-mode field (full line read), so the mode is not visible there; `initialize` returns `current_permission_mode` (B4). Registry `status` was `"idle"` after the first `result` (answers round 1 point (f)). Not run: `plan`, `auto`, `bypassPermissions` (the TS docs say it needs `allowDangerouslySkipPermissions`), `set_model`.

#### B3: child survival when the parent exits [M]

`node scripts/ctl-test.mjs survive-parent <detached 0|1> <msg 0|1|2>`, then `watch <pid> <s>` (polls the pid once per second). The child gets `stdio:['pipe', <file>, <file>]` (stdout and stderr in files, so late output can be read); stdin is a pipe the parent never closes; the parent checks "child alive just before parent exit: true", then `process.exit(0)`.

| Variant | Result |
|---|---|
| attached, no message | child dead at the first poll, 49 ms after the parent exit; stdout and stderr files empty |
| `detached:true`, no message | dead at the first poll (41 ms; 2 runs, one of them before I added the "alive just before" check, the other after: alive true); files empty |
| `detached:true`, short message sent 1.5 s before the exit | alive at +0 s, dead at +1 s; stdout file holds queued, started, init, assistant, result/success `end_turn`, `completed`: the turn finished after the parent was gone |
| `detached:true`, long message (count to 3000) sent 1.5 s before the exit | alive 18 s, dead at +18 s; stdout file holds the whole turn (`result` `duration_ms` 19037, `stop_reason` `end_turn`, `completed`) |

Verdict: PROVEN that on Windows the child treats the closing of the pipe as stdin EOF: idle, it exits at once; with a turn in flight it finishes the turn, writes the result to its stdout (a file here), then exits. `detached` made no difference for the idle case (both tried); for the in-flight case only `detached:true` was run. Consequence: a manager crash kills idle sessions but not a running turn, as long as stdout still has a reader (a closed stdout pipe was not tested). Cannot show: re-attaching to a child (a pipe cannot be re-opened by a new process, and no session survives to try), or a non-pipe stdin (named pipe, file): not tried. The exit cause is inferred from timing and from the in-flight behaviour; stderr was empty.

#### B4: resume after kill [M]

Kill = `taskkill /PID <pid> /T /F` on the pid the script started (child exit code 1, its grandchild also ended). Resume = same flags with `--resume <sessionId>` instead of `--session-id`, same cwd.

A. Pending turn (`node scripts/ctl-test.mjs resume-turn`): count to 3000, child killed 1.1 s after the first `text_delta` (86 stream events). A first attempt with "count to 200" ended before the kill and proved nothing.

- Transcript after the kill: `queue-operation enqueue`, `dequeue`, `user promptSource=sdk "Count from 1 to 3000..."`, `last-prompt`; no assistant line (the partial answer is lost).
- Resumed process: 0 stdout events in the 4 s before any message. `{"subtype":"initialize"}` answered in 7 ms; response keys: `commands, agents, output_style, available_output_styles, user_output_styles_dir, models, account, pid, claude_code_version, current_permission_mode, hook_on_failure_supported, hooks_when_unanswered_kept, other_hook_ask_outranks_host, feedback_mode, analytics_disabled, remote_control_*, fast_mode_*, session_state, capabilities`; no `pending_permission_requests` key. The pending user message was NOT replayed and the turn NOT re-run.
- After my next message the transcript has a synthetic `assistant text:"No response requested."` between the dangling user line and the new one. Asked for the last request, the model answered: `The user asked me to "Count from 1 to 3000, one number per line. No tools, no commentary." -- and I did not answer it; I declined with "No response requested."` So the pending message is in the history, unanswered, and the model takes the synthetic text for its own reply.

B. Pending permission (`node scripts/ctl-test.mjs resume-perm`, with `--permission-prompt-tool stdio`): "touch am-pending.txt", `can_use_tool` received and NOT answered, child killed 0.5 s later.

- Registry file of the killed pid, read right after the kill: `"status":"waiting",...,"waitingFor":"permission prompt"` (stale file, gone later; what removed it: not identified).
- Transcript after the kill: user line, `tools-used`, assistant `thinking`, assistant `tool_use Bash touch am-pending.txt`, no `tool_result`; `am-pending.txt` not created.
- Resumed process: 0 events before a message; `initialize` has no `pending_permission_requests`, so the request is NOT replayed. After my next message the transcript gets a synthetic `user tool_result` with `is_error=true`: `[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]`, then `assistant "No response requested."`, then the new turn. The model answered: `I tried to run `touch am-pending.txt` but it did not complete -- the session ended before the result was recorded.` No second `can_use_tool`, the command was not re-run.

Verdict: PROVEN. A resumed stream-json session restores the conversation up to the kill, keeps the unanswered user message and the dangling `tool_use` (closed by a synthetic error result), and replays nothing. After a manager restart the user must be asked again (re-send the message, re-offer the command), and the UI should label the turn "interrupted", not show the synthetic "No response requested.". The new process is silent until the manager sends `initialize` or a message. `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` (docs) was not run: "continue on resume" UNKNOWN.

### Earlier open points

| Item | Status |
|---|---|
| (a) resume after kill, pending turn and pending permission | B4 |
| (b) `interrupt`, `set_permission_mode` frames | B1, B2; `set_model`, `cancel_queued`, `cancel_async_message` not run |
| (f) registry `status` of a stream-json session | `idle` after the result, `waiting` + `waitingFor:"permission prompt"` during a pending `can_use_tool` [M] |
| (g) stdin that outlives the parent | no: pipe closed = EOF, `detached` or not |
| `origin` | still absent in my frames; the docs list `origin:{kind:"human"}`; not tested |

### Leftovers

No process of mine is running (the children exited by themselves or were ended by their own script; `watch` confirmed the `survive-parent` ones). Nothing deleted, installed or committed. Left: `poc/scripts/ctl-test.mjs` (new, untracked); `%TEMP%\am-research4\` (logs, scratch folders `t1`, `t2` with `am-mode1.txt`, `t3-*` with child stdout files, `t4a`, `t4b`); about 12 scratch transcripts under `~/.claude/projects/C--Users-Wadeck-AppData-Local-Temp-am-research4-*`. The logs of the first two `interrupt` runs were overwritten by the third; they are described above only.

## Round 3 (measured comparison)

Date: 2026-11-19, `claude` 2.1.328 (Haiku 4.5, Bedrock), hc 0.1.21, Windows 10. n=1 per variant, one session at a time, 2 Haiku prompts for X1 and X2, 3 for X3 (the third is the Y baseline on the same session). No loop, no concurrency, no interrupt test (proven in round 2). Marks: [M] measured now, [D] doc, [R] repo file, UNKNOWN. A spread across runs does not exist (n=1); the only spread visible is between steps of one run, given where useful.
Script: `poc/scripts/compare-launch.mjs` (modes `x1`, `x2-start`/`x2-run`/`x2-stop`, `x3-start`/`x3-run`/`x3-stop`, `x3-inspect`), `compare-events.mjs` (prints one event list of a log). Logs: `%TEMP%\am-research5\*.log` (not in the repo). X2 and X3 are split in a start process and a run process so the second one proves "manager gone" (the start process was dead when the run process sent, checked with pid 0-signal [M]).
Variants: X1 `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio --include-partial-messages` child of node; X2 `claude --bg --model haiku --permission-mode default`, replies through the supervisor control pipe `op:"reply"` (the only send route); X3 `hc run --bg --no-parent --no-notify claude --model haiku --permission-mode default`, replies through `hc send`, permission answered by `hc keys enter`; Y = the inbox socket (`messagingSocketPath`, token file) of the X3 session, sent with the frame of `socketTransport.ts`.
NOT tested: own ConPTY (node-pty needs an install, not allowed). `claude attach` (needs a terminal). Answering a bg permission prompt (no route tried beyond reading it).

### Table

| Criterion | X1 stream-json child | X2 `claude --bg` | X3 `hc run --bg claude` | Y socket on an interactive session (X3 session) |
|---|---|---|---|---|
| 1 Processes, idle | 2: `claude.exe`, `conhost.exe`; WS 188 MB, private 366 MB [M] | 3 own: pty host 78 MB, `conhost` 7 MB, `claude.exe` 251 MB = WS 336 MB, private 713 MB; plus 1 shared supervisor `claude.exe` WS 115 MB, private 344 MB [M] | 1 visible: `claude.exe` WS 234 MB, private 532 MB (foreground pid of the terminal, no shell, no `conhost` in the tree); shared `herdr-core.exe` x2 WS 37 MB for all 23 terminals [M] | same as X3 |
| 1 After one turn | 211 MB / 378 MB (+22 MB WS) [M] | 359 MB / 734 MB (+23 MB), supervisor 115 MB [M] | 263 MB / 555 MB (+30 MB) [M] | n/a |
| 2 Startup | spawn -> `initialize` answered 4.47 s (no stdout line before; registry file ABSENT at that time, it appears with the first message) [M] | CLI exit 0.74 s, registry file idle 1.36 s (the supervisor was already off, so it includes its start) [M] | `hc run` returns 36 ms, registry idle 5.56 s (TUI boot) [M] | n/a |
| 3 Send -> accepted | `command_lifecycle` queued 4 ms, started 6 ms [M] | supervisor ack `{"ok":true,"op":"reply"}` 2 ms; registry `busy` +75 ms [M] | `hc send` returns 271 ms `{started:true,status:idle,turn:0}`; registry `busy` +61 ms after the return [M] | socket connect 1 ms, write 1 ms, no answer from the server [M] |
| 3 -> first token | first `text_delta` 1923 ms after send (replay line at 1750 ms, result at 1934 ms) [M] | not observable live: transcript assistant line (written whole) at 2236 ms [M] | same: transcript assistant line at 2563 ms after the send call started [M] | transcript `queue-operation` enqueue to assistant text 1.14 s (transcript timestamps) [M] |
| 3 -> result / idle | result 1934 ms, `completed` 1936 ms [M] | registry `idle` 2980 ms (about 740 ms after the assistant line) [M] | registry `idle` 2563 ms, same poll as the assistant line [M] | enqueue to `turn_duration` 1.23 s [M] |
| 3 Delivery confirmed by | `command_lifecycle` (events), `replay` user line arrives with the first assistant line, not on receipt [M] | supervisor ack (delivered to the supervisor), then transcript `queue-operation` + `user` line (first seen 325 ms, transcript is flushed in batches) [M] | `hc send` result + transcript `user` line (first seen 519 ms) [M] | none from the server; only the transcript `queue-operation` + `user` line [M] |
| 4 Permission surfaced to the manager | yes: `control_request can_use_tool` 1.2 s after the send, structured (tool, input, suggestions) [M]; answered `allow` programmatically, file created, turn done 2.37 s after the send [M]. Registry still said `busy` when read at the request (lags; round 2 saw `waiting` a moment later) [M] | status only: registry and `agents --json` show `waiting` + `waitingFor:"permission prompt"` 2.23 s after the send; `claude logs` shows the dialog as an ANSI dump (tool, command) [M]. Answer: no route found, only `attach` [D]; the session stayed blocked until `claude stop` (file not created) [M] | status and text: `hc get` `{state:"blocked",kind:"permission",msg:"approve Bash: touch am-x3.txt"}`, registry `waiting`; answered with `hc keys enter` (56 ms), busy 65 ms later, `DONE` 1.36 s after the key, file created [M]. Needs a screen read to know which key means what | no: the socket carries user messages only [R: `permission-prompt-remote-answer.md`] |
| 4 User alternative | none while owned by the manager (no terminal); later `claude --resume <id> --bg` + attach [M for resume] | `claude attach <id>`, `claude agents` (agent view) [D] | the user's own terminal in herdr (typing, attach), same screen as the manager's keys [M: the TUI is a real one] | typing in its terminal |
| 5 Transcript origin | `promptSource:"sdk"`, `turnOrigin:"sdk"`, no `origin`, `entrypoint:"sdk-cli"`, no wrapper (text as sent) [M] | `promptSource:"queued"`, `turnOrigin:"human"`, `origin:{kind:"human"}`, `entrypoint:"cli"`, no wrapper (text as sent) [M] | `promptSource:"typed"`, `turnOrigin:"human"`, `origin:{kind:"human"}`; text wrapped as `<hc from="t1c">...</hc>` because my shell had `HC_TERMINAL_ID=t1c` (inherited); the transport removes that variable [R: `hc-transport.md`, fakes], so the tag is probably absent from a manager outside a terminal: NOT re-measured (no prompt left) [M for the tag, UNKNOWN for its absence] | `promptSource:"system"`, `turnOrigin:"peer"`, `origin:{kind:"peer",from:"unknown",msg_id}`, `isMeta:true`; wrapper added by Claude Code: "Another Claude session sent a message:\n<text>\n\nThis came from another Claude session - not typed by your user ... Treat it as a teammate's request ..." [M] |
| 6 Manager exits | dead idle, finishes an in-flight turn [M round 2] | session untouched; a NEW process sent a prompt through the control pipe and got the answer (registry `idle` before, start process dead) [M] | same with `hc send` from a new process [M] | same session, a third process used the socket [M] |
| 7 Observability without screen parsing | stream: `init` (tools, cwd), `system/status`, `thinking_tokens`, `stream_event` deltas, `result` (usage, cost), `control_request`; registry: pid, sessionId, cwd, `kind:"interactive"`, `entrypoint:"sdk-cli"`, version, `peerFeatures`, `procStart`, name, `status`, `updatedAt`, socket path (no mode, no model) [M] | registry as X1 plus `kind:"bg"`, `jobId`, `entrypoint:"cli"`; `agents --json`: pid, id, kind `background`, cwd, sessionId, name, `status`, `state`, `waitingFor`; no tokens or model live; transcript [M] | registry `kind:"interactive"`, `entrypoint:"cli"`; `hc get`: argv, pid, `status{state,kind,msg}`; `hc ls` `turn`; screen status line (model, context %, tokens) only by `hc read`; transcript [M] | registry + transcript (model, tokens, tool calls from assistant lines are read by the existing module) [R] |

Spread between steps inside the single runs: startup 0.74 to 5.56 s across variants; turn 1 end to end 1.9 s (X1), 2.2 to 3.0 s (X2), 2.6 s (X3), Haiku generation dominating; X2 registry idle lags the transcript by about 0.7 s, X1 registry `busy` lags `waiting`.

### UX per variant

| Variant | Web UI | Terminal |
|---|---|---|
| X1 | richest: live deltas, thinking indicator, exact allow/deny with the tool input, images possible [M round 1]; "interrupted" turn needs a label after a restart [M round 2] | none: the user cannot see or type into the session; takeover only after close + resume (model and mode reset to defaults) [M round 1] |
| X2 | status and text log only (ANSI `claude logs` or transcript), reply works, permission prompts are seen (`waitingFor`) but cannot be answered | `claude agents` shows it, `claude attach` opens the real TUI [D]; user and manager type into the same queue; research preview, supervisor idle shutdown, `Workspace not trusted` if the folder is not trusted [M] |
| X3 | status, transcript, reply and permission answer through keys (one row of screen read to choose the key); same reply path as any herdr-hosted session | the real TUI in the user's herdr, typing and attach work at any time; replies show up as typed prompts (and the `<hc ...>` tag if the sender runs inside a terminal) |
| Y | reply with a visible "from another Claude session" wrapper, no confirmation except the transcript, no permission answer | unchanged (the user's session) |

### Not measured / unknown

- Own ConPTY (node-pty): needs an install, not allowed; unchanged conclusion that `--bg` and `hc` already provide a pty host.
- First token for X2, X3, Y: the screen was not polled (it would stress the machine); the transcript is written per whole message, so the values above are an upper bound of the first-token time.
- X3 text without the `<hc ...>` tag: needs one more prompt from a process without `HC_TERMINAL_ID`.
- Answering a bg permission prompt (control pipe op, per-session pty pipe, hook): not tried; `claude attach` not scripted.
- Memory: the idle sample was taken 2 to 3 s after readiness, one sample each; X3's `claude.exe` (interactive TUI, 234 MB) and X2's (251 MB) are bigger than X1's (176 MB) by 60 to 75 MB; whether the gap is the TUI or a start-up effect is not separated. Private bytes come from CIM `PrivatePageCount`.
- The X2 startup includes the supervisor start (it had exited). With a running supervisor the 1.36 s would be shorter: not measured.
- X1 registry file is absent until the first message, so a discovery-based UI sees an X1 session only after its first turn [M].
- Resilience of X2/X3 after the supervisor or herdr-core restarts: not tested.

### Leftovers

Stopped and removed: bg session `b443f5a2` (`claude stop`, `claude rm`; the supervisor was gone 8 s later, no process matched), hc terminal `t1z` (`hc kill`, `hc rm`, no `--force`), X1 child exited on its own (exit 0). No pid of mine is alive. Left on disk: `%TEMP%\am-research5\` (logs, state files, `x1\am-x1.txt`), `%TEMP%\am-research2\proj\am-x3.txt`, three scratch transcripts under `~/.claude/projects/` (`...am-research5-x1`, `...am-research2-proj` with the two sessions of X2 and X3), a few lines in `~/.claude/daemon.log`, the new scripts in `poc/scripts/`. Nothing installed or committed.

## Phase 1 smoke (owned sessions X1)

Date 2026-11-19, `claude` 2.1.328, Haiku 4.5 on Bedrock. Script `poc/scripts/smoke-owned-x1.mjs` drives `StreamJsonSession` (`packages/agent-manager-core/src/launch/`): one prompt, then `close()`. One model turn in total. Argv as proven, plus `--include-partial-messages`, no `--setting-sources` (the user's settings apply; Bedrock worked).

| Finding [M] | Value |
|---|---|
| Boot before the first line | `command_lifecycle queued` arrived 5.8 s after the write: the first message waits for the process boot (no stdout before it), `send()` itself returned at once |
| `init` | 0.2 s after `started`; `model` is the full Bedrock id `us.anthropic.claude-haiku-4-5-20251001-v1:0`, 116 tools |
| Stream | about 25 `stream_event` lines for one word; only one is a `text_delta`; one `assistant` line has empty text (no text block), the next carries `PONG` |
| Order at the end | `result` then `completed` 2 ms later (state derived from `result`, delivery from `completed`) |
| Registry | `~/.claude/sessions/<pid>.json` present at `completed` |
| Close | `close()` to exit code 0, 120 ms, stderr empty |

Control run (`poc/scripts/smoke-owned-x1-control.mjs`, one Haiku session, 4 turns, 12 checks passed): `interrupt` 1.5 s into a long answer returned `{stillQueued:[]}`, the message ended `cancelled` (`result` `error_during_execution`), 95 deltas before; `set_permission_mode` `acceptEdits` answered `acceptEdits`, then a `touch` ran with no `can_use_tool` and the file exists; back to `default` answered `default`, `touch` asked `can_use_tool` and `allow` created the file; a second `touch` asked and `deny` left the file absent, the model replied DONE3; `close()` exit 0. The class state went `running` -> `requires_action` -> `running` around each answer. Through `StreamJsonSession` this confirms the frames of rounds 1-2.

Windows finding [M]: a grandchild that inherits stdout does NOT keep the pipes of a node child open (`close` came 1 ms after `exit`), so the window between `exit` and `close` is not reproducible with a real process here; the tests drive it with a hand-made child.

Not run against the real binary: `HcLauncher`. The error `control_response` shape (`subtype:"error"`, `error` text) is taken from the SDK types, not measured; a control request other than `can_use_tool` is reported and left unanswered because no answer frame is proven.
