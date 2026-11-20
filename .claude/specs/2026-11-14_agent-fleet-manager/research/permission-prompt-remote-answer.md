# Answering a pending permission prompt from another process

Date: 2026-11-15. Claude Code 2.1.325 (`claude --version`), Windows 10, Bedrock. Docs fetched 2026-11-15 from `https://code.claude.com/docs/en/{hooks,permissions,cli-reference,headless,remote-control,channels,channels-reference,agent-view,keybindings,permission-modes}.md` (saved in a temp folder, not in the repo).
Status marks: [M] measured by me today, [D] official doc fetched today, [B] read in the installed binary, [R] read in a local file, UNKNOWN.
Question (user): a session blocked on a permission prompt cannot be answered in its terminal; can the web UI approve or deny it?

## Conclusion

1. All 16 live Claude sessions on this machine are hosted by herdr-core (`herdr-app.exe > herdr-core.exe > powershell.exe > claude.exe`), whose CLI `hc` has `hc keys <terminal> <keys>`. I answered a real permission dialog with `hc keys t1q enter` on a session I started myself [M]. This is the only mechanism that also answers a prompt that is ALREADY open.
2. A `PermissionRequest` hook that holds and then returns `allow`/`deny` also answers a dialog that is already displayed [M interactive], but only for prompts that appear after the hook is registered.
3. The inbox socket has no frame that answers a dialog [B]. Remote Control and Channels (permission relay) are unavailable on Bedrock [D]. `--permission-prompt-tool` is print mode only [D]. Even Claude's own agent view cannot answer a dialog without attaching [D].
4. The `herdr` 0.9.5 CLI studied earlier (`reply-transports.md`) is NOT what hosts the sessions: `herdr agent list` answers `server_not_running` [M]. The host is herdr-core / `hc` 0.1.21 [M].

## Evidence

### Who hosts the sessions [M]

| Fact | Evidence |
|---|---|
| Parent chain of each of the 16 `claude.exe` | `powershell.exe > herdr-core.exe > herdr-core.exe > herdr-core.exe > herdr-app.exe` (CIM process list, names only) |
| `hc` | `C:\Users\Wadeck\AppData\Local\Programs\herdr-core\hc.exe`, `hc 0.1.21`; `HC_TERMINAL_SOCKET=\\.\pipe\herdr-core-Wadeck-default.sock` is set in the agents' environment (it was set in mine) |
| Terminals | `hc ls` lists tN with `agent: claude-code` and `status` (done, working, idle); `hc get t7` shows `foreground.argv = claude.exe --dangerously-skip-permissions` and `status.state` |
| Status vocabulary | schema (`hc schema`): "idle, working, done, blocked or error"; blocked reason "permission, question or auth (blocked only, when the program said)" |
| Who sets `blocked` | UNKNOWN (screen detection or a Claude hook; `hc get` shows `"reported":true`). Observed on my terminal: `{"app":"claude-code","kind":"permission","msg":"approve Bash: touch exp2-perm-file.txt","state":"blocked"}` |
| Old `herdr` CLI | `herdr agent list` -> `server_not_running` at `C:\Users\Wadeck\AppData\Roaming\herdr\herdr.sock` |
| Session `dsl-view-owner` | no registry file has that name now (`dsl-owner` exists, status `shell`); `hc` terminal t7 (title `dsl-owner`, cwd `dsl-view`) is `done`; no terminal was `blocked` when I listed. I cannot say which terminal held the screenshot's prompt: UNKNOWN |

### `hc` input commands (`hc <cmd> --help`, `hc schema`) [M]

| Command | Documented behaviour |
|---|---|
| `hc keys <t> <keys...>` | "Press named keys, encoded for the program's current keyboard modes, after ~3 s of quiet. Does not wait for an unsent draft." Keys: enter, esc, tab, up, ctrl+c, alt+x, f5, letters. No `blocked` refusal documented |
| `hc send <t> <text>` | "Paste text and press Enter ..."; "Refuses a blocked program unless `force`" (`--force`: "it may answer its dialog"); `--if idle|working` |
| `hc read <t> [--lines N]` | prints screen and history, read-only |
| `hc wait`, `hc events` | wait for a turn end or blocked news; events follow changes |
| Remote | `hc connect` (API over stdin/stdout), `--on <machine>`; `hc schema` is the API as JSON Schema (69 KB, saved only in a temp folder) |

### Mechanism 1: `hc keys` answers a dialog [M, my own terminal t1q, Haiku 4.5, 2 interactive prompts]

| Step | Result |
|---|---|
| `hc run --bg --no-parent --no-notify ... node launcher.mjs` (launcher starts `claude --model haiku --setting-sources project --permission-mode default` with Bedrock env) | terminal live, workspace trust dialog shown |
| `hc keys t down enter` on the trust dialog | accepted ("Yes, I trust this folder") |
| Tool prompt displayed; `hc get` | `state: blocked`, `kind: permission`, `msg: approve Bash: touch exp2-perm-file.txt` |
| `hc read` of the dialog | `Do you want to proceed?` / `1. Yes` / `2. Yes, and always allow access to <dir> from this project` / `3. No` / `Esc to cancel [middle dot] Tab to amend` |
| `hc keys t enter` | the command ran (file created), status `done` within seconds |
| Not tested | `esc` (documented "Esc to cancel", `keybindings.md`: `confirm:no` = Escape, `confirm:yes` = Enter, Up/Down move, Shift+Tab allows for the session), option 2, option 3, a user typing at the same moment |
| Cleanup | `hc kill amexp-perm` then `hc rm amexp-perm` (only my terminal); `hc ls` shows none left |

Notes: the options differ per dialog (the option 2 text depends on the tool; file-edit dialogs derive options from the request, `hooks.md` "PermissionRequest input"), so keys must be chosen from a read of the screen, not hard-coded. The default highlighted option is `1. Yes`, so a bare `enter` means "yes once".

### Mechanism 2: `PermissionRequest` hook [D] + [M]

[D] Contract (`hooks.md`, section "PermissionRequest decision control"): output `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow|deny","updatedInput":{...},"updatedPermissions":[...],"message":"...","interrupt":true}}}`. `message` and `interrupt` are for deny only. Exit code 2 is not honoured. Input: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `tool_name`, `tool_input`, optional `permission_suggestions` (no `tool_use_id`). "A hook returning allow doesn't override a matching deny rule" and the modified input is re-evaluated against deny and ask rules. Types supported: command, http, mcp_tool, prompt (not agent). Default timeout 600 s for command/http/mcp_tool; a timed-out hook does not block (the flow continues to the dialog). `PreToolUse` timeouts likewise "continue through the normal permission flow". "Claude Code runs a Notification hook with permission_prompt only after the prompt has waited about six seconds" (PermissionRequest is the immediate signal). Not fired for sandbox network prompts. Version gates: `onFailure` needs 2.1.295; this install is 2.1.325.

[M] Interactive (my terminal t1q, hook holding with a 2 s poll of a file):

| Test | Result |
|---|---|
| Hook holds, no decision | the dialog IS displayed while the hook runs (`hc read` shows `Do you want to proceed?`); the two are parallel |
| Dialog answered by `hc keys enter` while the hook still runs | tool ran; the hook was NOT killed, it kept polling until its own 45 s limit (log: alive until s=44, `end-no-decision`) |
| Hook returns `allow` 1.1 s after the dialog appeared | dialog closed, tool ran, transcript line `Allowed by PermissionRequest hook`, no key pressed |

[M] Headless `-p` (2 runs, Haiku 4.5):

| Test | Result |
|---|---|
| PermissionRequest hook only, `touch` needs approval | hook fired (stdin has `hook_event_name: PermissionRequest`), held 3 s, `allow` -> command ran, `permission_denials: []` |
| PreToolUse hook returning `ask` + PermissionRequest hook that allows | PermissionRequest did NOT fire; the call was denied (`permission_denials` has the Bash call), result text asked for permission (n=1) |

UNKNOWN: whether, in an interactive session, a PermissionRequest hook fires for a dialog opened by a PreToolUse `ask` (the w-guardrails case). Run 1 says no in `-p`; `w-guardrails/README.md:298` ("no PermissionRequest event emitted" for `.claude/` paths, "correctly prompts" elsewhere) implies it may fire interactively. Needs one interactive run (see Asks).
UNKNOWN: whether hooks added to settings are picked up by sessions already running (docs not read on this; not tested).

### Mechanism 3: first-party remote channels [D]

| Channel | Verdict |
|---|---|
| Remote Control (`remote-control.md`, Requirements) | not available on Amazon Bedrock, Vertex, Foundry, nor with `ANTHROPIC_BASE_URL` elsewhere; claude.ai login required, API keys unsupported. It would forward permission prompts ("Forwarded dialogs expire", "keeps permission prompts ... open until you answer") |
| Channels permission relay (`channels-reference.md` "Relay permission prompts") | would be ideal (prompt relayed in parallel, first answer wins, `request_id` of 5 letters); `channels.md`: "not available on Amazon Bedrock, Google Cloud's Agent Platform, or Microsoft Foundry"; also needs `--channels` at launch |
| `--permission-prompt-tool`, `--permission-prompts` (`cli-reference.md`) | "non-interactive mode" / print mode only; cannot attach to a running interactive session |
| Agent SDK `canUseTool` | for sessions the host spawns; this is how Desktop/VS Code host Claude Code (`hooks.md`, Notification section); not attachable |
| Agent view / `claude attach` (`agent-view.md`, "peek panel") | background sessions only; "A permission prompt or another dialog ...: replying doesn't answer it. Your message waits in the queue. To answer the dialog, attach" |

### Mechanism 4: inbox socket frames [B]

Installed binary `C:\Users\Wadeck\.local\share\claude\versions\2.1.325` (read-only scan, JS source embedded in plain text). Receive dispatcher near offset 346217038-346221700:

- `type` must be `user` (queued as a user message, log `Routed user message to queue`) or `control`; otherwise `Received unhandled message type`.
- `control` actions handled: `rename`, `peer_message_status` (status held/denied/expired/delivered/refused/dropped), `notify_when_idle`, `peer_idle_notice`, `yield_artifact_replies`, `unyield_artifact_replies`, `artifact_replies_yielded`; else `Unhandled control action`.
- No frame for a permission or dialog answer: none found. Strings `permission`/`control_request` appear only in the SDK stream schema (offset ~166.7M, `control_request_progress`, `tool_host_result`), not in the socket module (module-local search for `permission*`, `control_*`, `canUseTool` returned nothing).
- A `user` frame sent to a blocked session waits in the queue (same behaviour the agent-view doc states for peek replies); it does not answer the dialog.

### Mechanism 5: w-guardrails [R]

| Fact | Evidence |
|---|---|
| Step 2 of `request-bypass.js` is a PreToolUse `decision: 'ask'` returned with `buildBypassAskMessage` | `w-guardrails/scripts/pre-tool-use.js:1033-1041`; emitted as `hookSpecificOutput.permissionDecision` (`:188-194`) |
| `ask` is converted to `deny` when `CLAUDE_SUBPROCESS_NONINTERACTIVE=1` and under `.claude/` | `pre-tool-use.js:176-188`, README `:298` |
| w-guardrails registers only SessionStart and PreToolUse (`*`) | `hooks/hooks.json`; no PermissionRequest hook, no external approval queue |
| Precedence among PreToolUse hooks | `deny > defer > ask > allow` (`hooks.md`, PreToolUse decision control): a second hook returning `allow` cannot pre-empt guardrails' `ask`. Only guardrails itself (reading a UI-approved queue) could turn that `ask` into `allow` |
| Session context | t7 runs `--dangerously-skip-permissions` [M]; hook `ask` decisions still prompt there (the user's screenshot shows it) |
| Security | the dialog is the "human confirmation" of the bypass protocol (`claude-code-hooks-and-transcripts.md`, "v2 design issue"). Any remote approver that an agent can reach converts it into agent self-approval (T-08) |

## Existing exposure (not caused by agent-manager) [M]

`HC_TERMINAL_SOCKET` is in the environment of every agent, and `hc keys <t> enter` needs only that pipe. Any agent Bash call can already approve another session's dialog, including bypass dialogs. Whether w-guardrails blocks `hc keys`/`hc send --force`: UNKNOWN (not tested, I did not run it against any session but my own). The pipe's ACL: UNKNOWN. Worth a new threat entry independent of this feature.

## Options ranked

| # | Mechanism | (a) stuck prompt now | (b) future prompts | Reliability | Windows | Security risk | Effort | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | `hc keys` (herdr-core), choose key from `hc read` of the dialog | yes, for any hc-hosted session (all 16 here); proven on my own session | yes | good: `blocked/permission` status + screen text give a precondition; races with a user typing; options vary per dialog; esc/option 2/3 untested | yes (is the host) | high privilege, but already reachable by any agent via the pipe; needs confirm, audit, loopback, shown command, "only permission kind" gate | low-medium (pipe or `hc` CLI client, screen parse) | RECOMMENDED |
| 2 | PermissionRequest hook holding on the daemon/UI, returns allow/deny | no | yes, only sessions whose settings had the hook at start (UNKNOWN: live reload) | proven interactive; hook is orphaned until timeout after a terminal answer; timeout leaves the dialog for the user (safe default); may not fire for PreToolUse `ask` (UNKNOWN interactive) | yes | decision can include `updatedInput`/`updatedPermissions` (an allow rule persisted to settings): restrict to allow-once/deny | medium (hook, daemon endpoint, fail-open) | second step, only if wanted without `hc` or for non-herdr terminals |
| 3 | PreToolUse hook consulting a UI queue (w-guardrails itself) | no | yes for guardrails asks only | deterministic | yes | weakens the human confirmation of the bypass protocol; cross-repo change | medium | not recommended |
| 4 | Inbox socket | no | no | no frame exists [B] | - | - | - | rejected |
| 5 | Remote Control, Channels relay | no | no | unavailable on Bedrock [D] | - | - | - | rejected |
| 6 | `--permission-prompt-tool`, SDK `canUseTool`, `claude attach` | no | only for sessions started by the host / background sessions | print mode or background only | yes | - | high (changes how sessions start) | rejected for running sessions |
| 7 | Own ConPTY wrapper (node-pty) | no | yes, wrapper-launched only | see `reply-transports.md` | yes | - | high | superseded by `hc` |
| 8 | `AttachConsole` + `WriteConsoleInput`, Windows Terminal, tmux, WezTerm, VS Code terminal | no (untested) | - | no public API for Windows Terminal (`reply-transports.md`); not needed here | partial | - | - | not pursued; macOS/Linux hosts: UNKNOWN |

## Recommendation

Implement option 1 in the daemon: a "blocked on permission" row shows the tool and command (from `hc get` `status.msg` and the transcript), and the UI offers Approve once / Deny only after a fresh `hc read` shows `Do you want to proceed?` and the status is still `blocked` with kind `permission`. Send `enter` for yes and `esc` for no; never `shift+tab` or option 2 from the UI. Audit every answer, require the CSRF header and a confirmation, and show a visible error when the session is not hc-hosted or no longer blocked ("answer it in its terminal"). Do not offer it for sessions whose dialog is a w-guardrails bypass step 2 unless the user opts in (T-08).

## Open items and asks

| Item | Action |
|---|---|
| `esc` and option 3 via `hc keys` | one more interactive run on a terminal I start (needs your OK for more model calls; I used 4 Haiku prompts: 2 `-p`, 2 interactive) |
| PermissionRequest after a PreToolUse `ask`, interactive | one more run with both hooks, same terminal setup |
| Who sets `blocked` in `hc` | read herdr-core docs or ask the herdr owner |
| Pipe ACL and guardrails coverage of `hc keys` | check `icacls`-equivalent on the pipe; add a guardrails rule if desired (D-B style) |
| node-pty for an own pty | not needed; no install requested |

Scratch files (not in the repo): `C:\Users\Wadeck\AppData\Local\Temp\am-research\` (scan scripts, hook scripts, logs, `hc-schema.json`). Nothing was committed or installed. Side effects: two scratch session transcripts under `~\.claude\projects\C--Users-Wadeck-AppData-Local-Temp-am-research-exp*` and files `perm-test-file.txt`, `exp2-perm-file*.txt` in the temp folder.
