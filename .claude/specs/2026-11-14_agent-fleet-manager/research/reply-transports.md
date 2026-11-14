# Reply transports -- delivering a typed reply (and images) into a live Claude Code session

Date: 2026-11-14. Gathered by sub-agents (hooks/channels/socket, herdr/terminal injection, PoC), plus the lead's own reads ([V]) and two owner replies.
Status: marked per claim. Measurements: `poc-report.md` (Claude Code 2.1.325, headless).

## Conclusion

Three transports are measured and wake an idle session: the inbox socket (no resident cost, private protocol, text only), an `asyncRewake` hook (documented, ~+45 MB and +4 processes per session) and a blocking Stop hook (documented, holds the turn open). Images travel as a file path in the text (works 3/3; an image block over the socket was ignored). Channels are out (Bedrock), headless `--resume` is out (user), herdr works only for panes inside herdr. The user asked for every sensible transport to be switchable from the UI.

## Decisions by the user (2026-11-14)

| Decision | Detail |
|---|---|
| Images by path only | "l'envoi d'une image doit se faire par le biais d'un path uniquement" |
| Channels infeasible | the user runs on Bedrock; docs also say channels do not work on Bedrock/Vertex/Foundry |
| `--resume` rejected | "Option E, non merci" (two writers on one session) |
| Several transports, switchable | support everything that makes sense, switch from the UI, test with numbers first; 10+ parallel sessions are common so cost per session matters |
| Owner of w-agent-wake | per the user, w-agent-wake "was built properly and works"; ownership unclear (see below) |

## Transports

### 1. Inbox socket (`claude-inbox.js`)

| Aspect | Fact | Status |
|---|---|---|
| Discovery | reads `~/.claude/sessions/<pid>.json` (sessionId, name, cwd, status, `messagingSocketPath`); pick by id, name, folder (last directory of cwd) or pid (`claude-inbox.js:85-93`) | [V] |
| Token | `<pid>.<sha256(socket path, lower-cased on Windows)>.key`, JSON with `peerToken` (32 hex); fallback to any `<pid>.*.key` (`:95-113`); Windows refuses a connection without the auth line (`:140-143`) | [V] |
| Frame | one JSON object per line: `{"type":"auth","token":...}` then `{"type":"user","message":{"role":"user","content":"<string>"}}` (`:124-125,139`); "full" variant adds `msgV:1`, `msg_id`, `priority`, `session_id`; a `session_id` mismatch is dropped (contract A5) | [V] code |
| Text only | `buildFrame` throws unless text is a non-empty string (`:116-129`); no test or code covers image blocks (`socket-contract.js:101-102` uses strings) | [V] |
| No acknowledgement | the socket never answers; the sender keeps the connection 300 ms (`DEFAULT_GRACE_MS`, `:31-32`) so the line is not cut | [V] |
| Liveness | `isAlive(pid)` = `process.kill(pid, 0)`, true also on EPERM (`:34-42`, used at `:77`); pid reuse is not detected; the registry also holds `procStart` and `startedAt`, unused by the plugin; stale files kept on purpose (`:48`) | [V] |
| Contract (observed on 2.1.319, Windows, `tests/contract/socket-contract.js`) | idle session: a turn starts; busy session: delivered between tool calls or after the turn; plain text, invalid JSON, unknown `type` ignored silently; wrong `session_id` dropped; no auth or wrong token (Windows): nothing delivered; `crossSessionInbound: hold`/`refuse`: held (`system/peer_message_hold`)/dropped; bypass-permissions session with no value: held even with the right token, delivered with `accept`; identical messages 200 ms apart: two turns (no dedup); size cap ~1M chars; at most 50 queued, sends throttled (docs) | [V] README table (`README.md:81-113`); not re-run by the lead |
| `crossSessionInbound` here | `"accept"` is set in user settings | [V] `C:\Users\Wadeck\.claude\settings.json:84` |
| Stability | README: "Not a public interface" (`README.md:91`), "UNSTABLE INTERFACE" (`claude-inbox.js:6`), section titled experimental (`README.md:81`); Anthropic documents only the auth line and the inbound controls; last recorded verification Claude Code 2.1.319 (`README.md:94`), installed 2.1.325 | claude-plugin-owner report + README |
| Public issues | anthropics/claude-code #103048 (open, Oct 2026: document the format; author found the message line in a debug hint, no response), #103123 (open: line format inferred from the #93720 repro; plain text silently ignored; non-child senders unclear), #107175 (open: proposes Varlink, calls the protocol private with weak delivery semantics, no maintainer response); PeterSR/claude-code-socket-transport says the wire format "is not a public interface and can change in any release", verified only on v2.1.233; docs say cross-session messaging is "plain text only" | agent report (fetched) |
| PoC | wakes idle 5/5, first stream event 325/331/446 ms, sender 7-12 ms write (+300 ms grace), 69 MB peak RSS transient, no resident process; image block ignored (n=1) | measurement, `poc-report.md` T1, T2 |
| Authority | the frame is a `user` role message, so it carries the authority of typed input | inference |

### 2. w-agent-wake mod + queue (`agent.message`)

| Aspect | Fact | Status |
|---|---|---|
| What it is | mod plugin (Claude Code >= 2.1.287, works on Bedrock) waiting on a queue `agent.message {to, text, from?, mode?, ref?}`; `to` is a session id or `project:<folder>`; `mode` `wake` or `passive` (rides with the next prompt); text cap 2000 chars; dedup by `ref`; after Esc a `wake` is deferred; Claude is told the message is not typed by the user and grants no permission | [V] README |
| Mechanism | one `queue wait agent.message` per session named `w-agent-wake.<first 8 chars of session id>.inbox` (needs queue-cli >= 2026.11.8-292) | [V] README |
| Cost table (measured on 2.1.319, queue-cli 2026.11.8-294, `tests/measure-footprint.js`) | 1 session: +81 MB private, +189 MB working set, +4 processes; 10 sessions: +1.6 GB private (+156 MB each), +2.0 GB working set (+195 MB each), +40 processes, +0.6 s CPU/min total; tokens none; baseline without plugin ~400 MB private/210 MB working set per session | [V] `README.md:63-79` |
| Provenance | the table measures the mod + `queue wait` path only; [V] git log of the plugin: cost commits `70a220f` (measured RAM/CPU replaces a wrong 21 MB claim) and `a3b9993` (tokens 0 on 2.1.319, lean-launch option) precede `a5aa1b1` (claude-inbox sender and contract tests, v0.2.0, the latest); the sender section says only "no extra process, no memory, no tokens while waiting", a claim not a measurement (`README.md:83`) | [V] + owner reply |
| Lean option | starting the wait as `node queue.cjs` would take one wait from 58 to 33 MB private (156 to 84 MB working set); relies on queue-cli's internal layout; measured, not done | [V] README |
| Wake cost | a wake-up turn costs 0.002 to 0.04 USD | [V] README |

### 3. `asyncRewake` hook

Documented: an `asyncRewake` hook exiting 2 wakes an idle session; stderr (or stdout) becomes a system reminder; text only; timeout enforced (agent report, hooks docs). Measured (`poc-report.md` T3, T5, T6): wakes idle 3/3; file written -> waiter detects 69/94/139 ms -> first event 101/117/163 ms; re-armed by the Stop hook of the wake turn; at the configured timeout (20 s in the PoC) the waiter dies and the session is deaf until the next Stop (n=1); waiter ~68 MB RSS, +43-50 MB private, +4 processes per session; an armed waiter delays session exit by ~30 s. The reply arrives as a system reminder, not a user message (agent report from docs). Default 600 s timeout, plain `async: true`, resume/compact not tested.

### 4. Blocking Stop hook ("hot wait")

Documented (agent report): Stop can continue a turn via `decision:"block"` + `reason` or exit 2; `stop_hook_active` loop guard; cap of 8 consecutive continuations; default hook timeout 600 s. Measured (`poc-report.md` T4): hook detects the reply 45/170/200 ms; assistant answer 966/1286/1316 ms; `stop_hook_active` true on chained stops (3/3); at expiry (15 s, n=2) the session goes idle; `result` is emitted only after the hook ends, so the turn looks longer by the wait. Works only while the turn is ending, not for long-idle sessions. Text only (reply as the `reason` string; images would be a path).

### 5. Hooks that cannot carry a reply

| Hook | Why not | Status |
|---|---|---|
| UserPromptSubmit | fires only on a user prompt; cannot wake an idle session | agent report |
| Notification | cannot block or modify; side effects only | agent report |
| PermissionRequest | covers only permission prompts; can hold a wait up to the timeout; parallel to the terminal dialog UNVERIFIED | agent report |

### 6. Channels -- rejected

MCP server per session emitting `notifications/claude/channel` (`{content:string, meta:Record<string,string>}`), arriving as `<channel source=... k="v">content</channel>`; research preview; needs claude.ai/Console auth, `--channels` allowlist or `--dangerously-load-development-channels`, Team/Enterprise `channelsEnabled`; not available on Bedrock, Vertex, Foundry; strings only (attachment mechanism UNVERIFIED); memory per session unmeasured (agent report). Rejected: the user is on Bedrock.

### 7. Others

| Mechanism | Fact | Status |
|---|---|---|
| Remote Control (https://code.claude.com/docs/en/remote-control) | local session driven from claude.ai/code or the Claude mobile app over outbound HTTPS polling; needs a claude.ai login; accepts image/file attachments from phone or browser; no public API, bound to Anthropic's apps | agent report |
| stream-json / Agent SDK | drives a `-p` session you spawn; cannot attach to an existing interactive session; image blocks in stream-json input UNVERIFIED; `--sdk-url` UNVERIFIED | agent report |
| `claude -p --resume` | rejected by the user | user decision |
| herdr socket (https://herdr.dev/docs/socket-api/) | herdr 0.9.5 installed at `C:\Users\Wadeck\.herdr\packages\standalone\releases\0.9.5-x86_64-pc-windows-msvc\herdr.exe`; Windows beta (https://herdr.dev/docs/windows-beta/), ConPTY runtime; named pipe, NDJSON, default `~/.config/herdr/herdr.sock` or `HERDR_SOCKET_PATH`, docs advise calling `HERDR_BIN_PATH`; methods `pane.send_text`, `pane.send_keys`, `pane.send_input`, `agent.prompt` (refuses with `agent_blocked` when the agent is blocked), `agent.send_keys`, `pane.read` (sources visible, recent, recent-unwrapped, detection), `pane.list/get` (`agent_status`, `agent_session`, `terminal_title`), `agent.list`, `events.subscribe` (`pane.agent_status_changed`, `pane.output_matched`, `pane.exited`; history not durable, resubscribe and reconcile with `session.snapshot` after `events_lost`); `pane.report_agent` accepts `idle`, `working`, `blocked` (https://herdr.dev/docs/add-herdr-support/); params of `send_text` and bracketed paste undocumented, `herdr api schema --json` is the authority (not run); reaches only panes inside herdr; no clipboard image bridge for local panes (images by path in text; multiline paste is bracketed; remote image drops only over `--remote`); the local hook gives pane-to-session mapping only | agent report |
| Own ConPTY wrapper (`agent-manager run claude`, node-pty) | pros: full stdin/stdout control; cons: only wrapper-launched sessions, key/resize/mouse relay, ConPTY quirks (older Windows 10 system ConPTY drops Kitty keyboard sequences; herdr bundles its own runtime), native module, +1 process per session | agent report |
| Happy (slopus/happy) | local mode spawns `claude` with `cross-spawn` and `stdio: ['inherit','inherit','inherit','pipe']`, `windowsHide:true` (`packages/happy-cli/src/claude/claudeLocal.ts`); fd 3 carries thinking-state events; remote input via `claudeRemote.ts` and an SDK folder (file names only); switches between terminal mode and SDK mode; Windows support of the CLI undocumented | agent report |
| AgentAPI (coder/agentapi) | in-memory terminal emulator, `POST /message`, `GET /status`, `GET /events` (SSE); archived/deprecated; Windows, bracketed paste, images not mentioned; screen scraping is the brittle part | agent report |
| `wezterm cli send-text [--pane-id] [--no-paste]` (https://wezterm.org/cli/cli/send-text.html) | sends bracketed paste when the pane has that mode; only WezTerm panes | agent report |
| tmux `send-keys` | no native Windows build; WSL only | agent report, own knowledge |
| Windows Terminal | no public API to send input to an existing tab found (UNVERIFIED); `wt.exe` only opens windows/tabs | agent report |
| `AttachConsole` + `WriteConsoleInput` (https://learn.microsoft.com/en-us/windows/console/writeconsoleinput) | Microsoft calls it the "wrong-way verb", no virtual-terminal equivalent, may not work in remoting; under ConPTY injected records become VT input; one console per process; whether Claude Code receives bracketed paste this way untested | agent report |

## Images

| Fact | Status |
|---|---|
| Claude Code ingests images by drag and drop, `Ctrl+V` clipboard paste (`Alt+V` on Windows and WSL; inserts an `[Image #N]` chip), or a file path in the prompt (https://code.claude.com/docs/en/common-workflows "Work with images", https://code.claude.com/docs/en/interactive-mode "General controls") | agent report |
| Pasted text over 800 chars or 3 lines collapses to `[Pasted text #N +L lines]`; the model is told pasted text may contain instructions the user did not write (https://code.claude.com/docs/en/terminal-config.md "Paste large content"); VS Code terminal can drop characters from very large pastes | agent report |
| Transcript shape: user line `message.content` = `[{type:"text"}, {type:"image", source:{type:"base64", media_type, data}}]` + `imagePasteIds` | agent report |
| A file `@`-reference is included only if it fits the Read limit (25,000 tokens), text files over 256 KB are not; `@image.png` inline vs Read prompt UNVERIFIED; image size limits UNVERIFIED | agent report |
| No documented route carries image blocks into an existing interactive session | agent report (inference) |
| Path in text over the socket: 3/3 correct through a `Read` call; block-array frame ignored | measurement, `poc-report.md` T2 |
| Terminal injection of an image: only a path via bracketed paste, or `Ctrl+V` after putting the image on the system clipboard (global state, races with the user's clipboard, needs a desktop session); Shift+Enter unsafe, use `Ctrl+J` or backslash+Enter; plain `\r` submits | agent report |

## Owner replies (facts only)

| Owner | Reply |
|---|---|
| claude-owner (session 8925c3) | had not examined w-agent-wake; its user told it to leave it aside; no verified answer; not sure it owns the plugin |
| claude-plugin-owner (session 849833) | read files and ran `claude --version` only, ran no test. (1) sender not called production-ready (`README.md:81,91`, `claude-inbox.js:6`); Cost table (`README.md:63-79`) is the mod path; no measurement of a send exists. (2) contract test added in `a5aa1b1` (2026-11-09), verified on 2.1.319, installed 2.1.325, not re-run (~15 model turns, ~15 min). (3) `crossSessionInbound` set per session or in settings; here already `"accept"` in user settings (`settings.json:84`), not in the local-marketplace project settings. (4) no PoC or test for an image path or image block; `buildFrame` string-only. (5) `alive` = `process.kill(pid, 0)` (`claude-inbox.js:34-42`), pid reuse undetected; the only real signal is the connect failing or timing out (`CONNECT_TIMEOUT_MS` 5000) |

## Comparison

| Transport | Wakes idle | Documented | Image support | Per-session cost | Main risk |
|---|---|---|---|---|---|
| Inbox socket | yes (PoC 5/5, ~330 ms to first event) | auth line only; frame private | path in text works; block ignored | none resident; 69 MB transient sender | unstable private protocol, no ack, held in bypass sessions without `accept`, pid reuse |
| `asyncRewake` hook | yes (PoC 3/3) | yes | path in text (inference) | ~+45 MB private, +4 processes (PoC) | timeout leaves the session deaf until the next Stop; stale replies; ~30 s exit delay |
| Blocking Stop hook | no (holds the open turn) | yes | path in text (inference) | one held process per turn | timeout (600 s default), 8-continuation cap, turn looks long |
| w-agent-wake mod + queue | yes | plugin README | path in text (inference) | +195 MB working set, +4 processes (older path, 2.1.319) | mod API "still moving" |
| herdr socket | yes, panes inside herdr only | herdr docs | path only | none beyond herdr | beta on Windows, undocumented params |
| ConPTY wrapper | wrapper sessions only | -- | path or `Ctrl+V` | +1 process per session | native module, key relay |
| Channels | yes (implied) | yes, research preview | unclear | one MCP process | not on Bedrock: rejected |
| Remote Control | yes | yes | yes (Anthropic apps only) | none | no third-party UI |
| `--resume` / SDK | n/a | yes | unverified | new process | two writers: rejected |
