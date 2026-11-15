# The `hc` reply transport: measurements and limits

Date 2026-11-15. hc 0.1.21, Claude Code 2.1.325, Windows 10. Marks: [M] measured today, [B] read in the binary, [F] fakes only (tests), UNKNOWN.
Context: `reply-wrapper-and-user-origin.md` (why), decision D-2026-11-15-b. Code: `packages/agent-manager-core/src/reply/hcTransport.ts`.

## hc interface used

| Call | Result [M] |
|---|---|
| `hc ls --json` | `{terminals:[{address, agent, state, status (string), cwd, turn}]}`; no pid |
| `hc get --json -- <t>` | `foreground.pid` (program that has the terminal), `pid` (shell), `status:{state, kind, msg}` or null |
| `hc send --json -- <t> <text>` | `{started, status, turn}`; `--` keeps a text starting with `-` as text |
| unknown terminal | stdout `{"error":{"kind":"not_found","message","hint"}}`, exit 3 |
| dialog open | `kind:"blocked"` (documented, measured earlier); status `blocked` has `kind` permission, question or auth |

- `hc send` has no stdin or file input: the text is one argument. Windows command line limit 32767 characters, so the transport refuses above about 30000 (quotes and backslashes counted twice). `hc connect` (protocol over stdin) could avoid this; its framing was not explored.
- `--if` is not used: the status of a finished turn is `done`, which matches neither `idle` nor `working`.
- No `--force`, no `--wait`.

## Session to terminal mapping

- Registry `pid` equals `foreground.pid` of the terminal [M]: 2 of 2 terminals started with `claude` directly (t1c, t2) and the test terminal.
- A claude started through a wrapper is NOT matched [M]: `hc run node launcher.mjs` (launcher spawns claude with a shell) gives `foreground.pid` of node, `agent` still `claude-code`. The transport reports "no terminal runs pid N". Not implemented: process tree matching (needs a process lookup per terminal on Windows).
- Only terminals with `agent == claude-code` are asked (one `hc get` each, 4 at a time, snapshot reused 2 s); 18 listed on this machine.

## Proven with a real terminal [M]

Terminal started with `hc run --bg --no-parent --no-notify --name am-hcmanual claude --model haiku ...` (Bedrock needs `env` in the project settings, else the terminal says "Not logged in"). One real send through the transport, run from an hc terminal with `HC_TERMINAL_ID=t1c`:
- probe found the terminal among 18; send returned `turn 0`, status idle.
- transcript user line: `origin:{kind:"human"}`, `promptSource:"typed"`, no `<hc` tag, marker line and the second line kept (`\n`). Haiku answered `PONG-HC`.
- a first attempt on a session not logged in: the text was typed, status became `blocked` kind `auth` ("Not logged in") after the send, `started:false`. The pre-check cannot see a dialog that opens after typing.
- Terminal killed and removed. Left behind: stale registry files of the killed sessions (`~/.claude/sessions/16576.*`, `26804.*`), which Claude Code does not remove on a kill.

## Only with fakes [F]

blocked refusal (before and from hc), ambiguous and absent terminal, hc missing, timeout (process stopped, error says the text may have been typed), non-JSON success answer, rate limit, over-long Windows text, NUL, argv shape, `HC_TERMINAL_ID` removal. The fake is `src/reply/fakeHc.mjs`, run as `node fakeHc.mjs`: a node script cannot be `hc` on the Windows PATH without a shell, so the transport takes `command` + `commandArgs`.

## UNKNOWN

- Draft wait: with a person's unfinished draft hc holds the send up to 60 s (documented); the send timeout is 90 s and a timeout leaves the outcome unknown. Not measured.
- Queued send while the agent works through this transport: measured by the researcher with `--if working` (`reply-wrapper-and-user-origin.md`), not re-run.
- Claude Code collapsing a long paste in the transcript; size limit of `hc send`; macOS and Linux.
- `origin.msg_id` is kept for a UUID-shaped id (any version): regex read in the binary [B]; our derived UUID was not re-measured end to end on a socket session today.
- `hc` delivery confirmation uses the text marker (no frame id); `turn` is returned as an informational handle (`t1w#turn0`), not a transcript key.
