# Adopting a session: switching the host of one Claude Code session (#71)

Date: 2026-11-21. Windows 10, Bedrock, Haiku 4.5, `claude` 2.1.330, `hc` 0.1.21. 5 Haiku prompts (the 5th by accident, see Leftovers), one process at a time, no loops.
Marks: [D] official doc fetched 2026-11-21 (code.claude.com: `sessions`, `agent-view`, `interactive-mode`), [M] measured now, [R] read in this repo, [U] unknown.
Script: `poc/scripts/adopt-test.mjs` (phases `x1`, `snap`, `tx`). Folder `%TEMP%\am-adopt\proj`, throwaway session `b7598fdb-c66a-4cfb-aa94-d78f09096a28` (only my own processes were killed). Context: `session-launch-options.md` (rounds 1-4), `session-fork.md`, `hc-keys-approval.md`.

## Conclusion

1. Identity holds: every hop kept ONE session id and ONE transcript file (X1 -> hc -> X1 -> hc), 0 duplicate uuids, in registry and transcript [M]. A switch is `stop` + `claude --resume <id>` on the target host; nothing else is needed for the history.
2. What is NOT carried is the in-flight work: a running tool keeps running unseen after `hc kill` (orphan, its side effect completed, the transcript never learned), a pending turn leaves a dangling user line closed by synthetic lines on the next resume, background tasks and monitors are not restored [M][D]. So the switch must be gated by a readiness check, and the button color is that check.
3. Cleanest stop of an hc terminal is `hc keys <t> ctrl+c ctrl+c` on an idle prompt: exit code 0, registry file removed [M]. `hc kill` works but leaves a stale registry file with status `busy` and `alive` false, and orphans the tool children [M]. `taskkill /PID` without `/F` does nothing to a console `claude` [M].
4. Two writers on one transcript lose messages [D]: before any resume, prove no live process holds the id (registry, owned live map, bg list). Not measured, it is a documented hazard.
5. The registry has no field for "something runs besides the turn". Today the list knows busy/idle/waiting and a count of sub-agent files, not running sub-agents, running background tasks or queued messages [R]. A 3-state readiness (free / busy-warning / unknown-as-warning) built on the transcript tail is feasible; its rule is below.

## Facts

| # | Fact | Mark |
|---|---|---|
| a1 | `claude -p --input-format stream-json --session-id N`: `system/init` `session_id` = N; transcript `N.jsonl`, all lines `sessionId` = N | [M] |
| a2 | `claude -p --resume N` (stream-json): init `session_id` = N, same file, no new file, registry entry (kind `interactive`, entrypoint `sdk-cli`) has `sessionId` = N | [M] |
| a3 | Interactive `claude --resume N` in an hc terminal: registry `sessionId` = N from the first poll (idle, before any message), entrypoint `cli`, `foreground.pid` of the terminal = registry pid; the screen shows the earlier turns including those made by the X1 hop | [M] |
| a4 | Whole chain X1 -> hc (2 prompts) -> kill -> X1 (1 prompt) -> hc (idle, then exit) -> hc (idle, killed): 1 file, `sessionIds` = [N], `duplicateUuids` = 0 after each hop | [M] |
| a5 | Doc: resume "continues the same conversation"; `--fork-session` is the only way to get a new id; `claude --resume <id>` of a bg session that still runs ATTACHES to it, and with flags like `--permission-mode`, `--model`, `--output-format` exits 1 telling to `claude stop <id>` first | [D] |
| a6 | Doc: resuming the same session in two terminals or two `-p` runs at once: both write one transcript, messages from one can be missing | [D] |
| a7 | Doc: resume restores history, model (interactive), permission mode (terminal without `-p`; `bypassPermissions` is NOT restored), active goal; NOT restored: background Bash and monitor tasks; a background sub-agent, Bash or workflow that ended with the old process shows as a note "did not finish" read with the next prompt | [D] |
| a8 | `--resume --bg` re-applied the user defaults (Sonnet, auto) instead of the launch flags (earlier research), so every host passes model and mode explicitly | [M] (session-launch-options.md) |
| a9 | Interactive resume in a folder not trusted: the trust dialog blocks (cursor on `No, exit`; `hc keys down enter` trusts); `-p` shows no dialog and IGNORES `permissions.allow` of the project until trusted | [M] |
| a10 | Clean ends: stdin close of X1 (exit 0) and `hc keys ctrl+c ctrl+c` on an idle prompt (hc `exit_code` 0, `reason` exited) remove the registry file of the pid | [M] |
| a11 | `hc kill <t>` (hangup then escalate) of a claude with a Bash tool running: claude gone, hc terminal `finished` (`reason` killed, `exit_code` 1), registry file `<pid>.json` + `.key` LEFT with `status` busy, `alive` false; transcript byte-identical to before the kill (60 lines, nothing flushed, no marker) | [M] |
| a12 | The tool child (`node wait.mjs`, parent bash, grandparent claude) SURVIVED `hc kill` and finished its work 24 s later (`wait-end.txt` written); the transcript does not know | [M] |
| a13 | Next resume (X1) after a11: transcript gets a synthetic `Tool call interrupted` result and one synthetic assistant `No response requested.`; the model answered "the command was interrupted, I don't know if it succeeded", although it had completed (silent divergence) | [M] |
| a14 | The stale registry file of the killed pid (a11) was gone after the next claude start/exit; the cleaner is not identified. A second pid (37480, survived taskkill in a16, then `hc kill`) left `<pid>.json` + `.key`, still there at the end | [M] cause [U] |
| a15 | `hc kill`ed and exited terminals stay in `hc ls --all` as `finished` until `hc rm <t>` (refuses a live terminal); `hc ls` hides them | [M] |
| a16 | `taskkill /PID <claude pid>` without `/F`: prints "end signal sent", `claude` still alive and idle 10 s later | [M] |
| a17 | `hc send <t> "/exit"` does NOT run the slash command: hc wraps the text as `<hc from="t..">...</hc>` and the model got a prompt (and my shell turned `/exit` into `C:/Program Files/Git/exit`; use `MSYS_NO_PATHCONV=1` or a literal Windows path) | [M] |
| a18 | While a Bash tool ran: registry `busy` (no `waitingFor`), hc status `working`, transcript tail = assistant `tool_use` without result (matching the unmatched-call logic of `logRoute.ts`) | [M] |
| a19 | hc terminal status after a turn is `done` while the registry says `idle`; `hc send --if idle` is refused with `status_mismatch` ("t25 is done, not idle") | [M] |
| a20 | A standalone `sleep N` Bash call is refused by Claude Code itself ("use Monitor or run_in_background"); a test tool must be a script | [M] |
| a21 | Resuming idle (no message) still appended 1 line to the transcript (102 -> 103) | [M] |
| a22 | Doc: Ctrl+C interrupts a running operation; idle: first press clears the prompt, second exits. Background tasks are cleaned at exit; `claude stop` of a bg session: whether in-flight tools get a graceful end is not said; background shell commands and sub-agents of a bg session "carry over to the next process" (bg host only), monitors do not | [D] |
| a23 | Registry liveness is pid-only (`procStart` not compared): a killed pid reused by another program shows `alive` | [R] |
| a24 | Today: `subagentCount` = number of `agent-*.meta.json` files, NOT running ones; per-agent status `active` is a heuristic (not finished and written within 10 min); tool call `running` = no result paired; no code pairs `run_in_background` calls with their `task-notification`, no code reads `queue-operation` for pending messages | [R] |

## Measured vs documented, per in-flight thing (Q4)

| In flight at the switch | Result | Mark |
|---|---|---|
| Tool running (Bash, `hc kill`) | claude dies, the child process lives on and completes; transcript silent; next resume marks it "interrupted" | [M] a11-a13 |
| Tool running, X1 `killTree` (`taskkill /T /F`) | children die with the tree; same dangling `tool_use` closed by a synthetic error result on resume | [R] code, result line [M] earlier (session-launch-options.md round 4) |
| Running turn (no tool) | partial answer lost, user line kept, synthetic `No response requested.` before the next message | [M] earlier (round 4) |
| Pending permission | not replayed on resume; synthetic error result for the dangling call | [M] earlier (round 4) |
| Sub-agent running | not measured; doc: reported as "did not finish" at the next prompt; sub-agent files stay on disk | [D] a7 |
| Background bash / monitor | not measured; doc: not restored, cleaned at exit | [D] a7, a22 |
| Queued user message (not yet absorbed) | not measured; earlier round: an unanswered user message is kept as a dangling line | [U] / [M] earlier |
| Stop while idle | nothing lost; 1 extra line on resume (a21) | [M] |

## Readiness for the button (Q5)

Signals available now: registry `status` (busy / idle / waiting / shell), `waitingFor`, `statusUpdatedAt`; hc terminal status (working / blocked / done); transcript tail 64 KB (digest, `logRoute` tool-call pairing: `running`); sub-agent files with the 10-minute heuristic; X1 `pendingPermissions`; `claude agents --json` state for bg (`working` also covers "between steps of work it drives", [D]).
Missing: running background Bash/monitor (needs pairing a `run_in_background` tool_use / `Monitor` call with its `<task-notification>` completion; the notification is a `queue-operation` and a user entry tagged `task-notification` [R]), queued-not-absorbed messages (`queue-operation enqueue` without `dequeue`/`remove`), scheduled wake-ups (`/loop`, cron: session-scoped tasks ARE restored [D] but a loop in the old host stops), and a tail window shorter than the open call.

Rule, evaluated by the SERVER at click time (the UI color is a hint, the server recomputes):

| State | Conditions (all) | Button | Text |
|---|---|---|---|
| free | pid proved alive and is `claude`; registry `idle`, status older than 3 s; transcript read OK and its tail covers the last user message; no unmatched `tool_use`; no `active` sub-agent; no background call without completion; no unabsorbed queued message; no waiting | neutral/green | "Nothing is running. The conversation moves as is." |
| busy-warning | any of: `busy`, `waiting`/`shell`, unmatched tool call, active sub-agent, background task without completion, queued message, permission prompt | amber, needs confirmation | one line per item: "Tool Bash `node wait.mjs` is running: it will be killed or orphaned, its result lost", "2 sub-agents active: reported as not finished", "Background task started 12:03: not restored", "Waiting on a permission prompt: not replayed", "A turn is running: the partial answer is lost" |
| unknown (treated as busy-warning) | pid alive but transcript missing or unreadable, tail window does not contain the last user message, status not in the known set, status stale beyond expectation, hc terminal not found for an hc session, `claude` version newer than the rules were checked on | amber, grey icon | "Cannot tell whether something is running (<reason>). Treated as busy." |

Not a warning but a refusal (no button): the id is live in another place that is not the one being stopped, the target host is at its cap, the folder is not trusted for the hc target (say so, with the one command), the registry pid is not a `claude` process.

## Recommended design

Flows (every flow = stop on the source, proof of death, resume on the target with explicit model and permission mode, then verify the new registry entry has the same id):

| Flow | Stop | Resume | Notes |
|---|---|---|---|
| external discovered, hc terminal -> X1 | idle: `hc keys <t> ctrl+c ctrl+c` and wait for pid death; busy: only after confirmation, `hc kill` then kill the listed tool tree is NOT possible (unknown children) so the warning says the tool may finish unseen | `SessionHost` stream-json with `resume: id`, model/mode from the registry/transcript | `hc rm` the finished terminal afterwards (mine only, by address) |
| external discovered, other terminal -> X1 | the app does not kill it: it tells the user to exit it (Ctrl+C twice) and offers Adopt once the pid is dead (poll). Escalation `taskkill /T /F` only behind PIN + typed confirmation, after process name and start time are checked (a23) | same | window of the user's terminal stays open at a shell prompt: not measured [U] |
| X1 -> hc | `SessionHost.stop` (stdin close, kill on timeout, exit 0) | `HcLauncher.launch({args: ['--resume', id, '--model', m, '--permission-mode', p]})`; wait for registry entry with that id | trust dialog blocks an untrusted folder (a9): check before stopping, never stop first and fail after |
| hc -> X1 | as the hc row above | owned record created/updated for id, `resume` path | `SessionHost.resume` works on existing owned records [R]; a record for a discovered id needs a new entry point (to design) |
| bg -> X1 / X1 -> bg | `claude stop <id>` (doc) ; X1 -> bg is `--resume <id> --bg` (measured earlier) | resume on target | a running bg session cannot be resumed with flags (a5) |

Checks before stopping (all server side, in this order): (1) source readiness computed (above) and acknowledged items match what the client confirmed; (2) target feasible (cap, trust, `hc` reachable, claude version); (3) pid verified (`claude` image, start time) before any kill; (4) no other live holder of the id; (5) the session is not mid-switch (an in-memory lock per id; a second request fails `switch-in-progress`).
After the stop: wait for pid death, then treat a registry file of a dead pid as residue (ignore for liveness, do not delete files owned by Claude Code), `hc rm` the terminal. A failure after the stop leaves the source stopped and says exactly: which step failed, the id, the command to resume by hand; never a silent fallback to the old host.
Audit: `session.adopt` intent and result lines through the existing `#audited` wrapper: from/to host kind, session id, source pid, terminal address, readiness state and the acknowledged in-flight items, outcome per step. Record the in-flight list in the transcript-side notice the user sees ("Adopted from X, a tool was running").
PIN class: `POST /owned/adopt` is `sensitive` in `commons/routeClasses.ts` (it starts and stops processes, same class as launch/stop); the read of readiness is a plain route (no secret beyond the log). Kill of a non-hc external process: its own sensitive route and a typed confirmation. New threat-model entry (T-20): killing the wrong process (pid reuse, a23), losing in-flight work, double writer on a transcript.

## TDD plan (as in `session-fork.md`, "Test strategy, from agent-fleet")

| Layer | What |
|---|---|
| Pure, always | `classifyReadiness(session, tail, subagents)` table tests built from fixtures of real tails: unmatched `tool_use`, `run_in_background` without and with `task-notification`, `queue-operation` enqueue/dequeue, active/finished sub-agent, `waiting`, unreadable transcript, tail too short -> unknown; one fixture per row of the Q4 table |
| Mock, always | fake `hc` through the `createHcRunner` seam and `fakeClaude.mjs`: the call order of each flow (stop, wait death, run, wait registry), same id across hops, refuse when another live holder exists, target failure after the stop (message names the step and the manual command), a stale registry file of a dead pid is ignored, `hc rm` called with the address of the finished terminal only, second request for one id fails, PIN class test (existing unclassified-route guard) |
| UI jsdom | button color and text per state, confirmation needed for amber, server recompute wins over the stale client state, A/B variants behind the dock per CLAUDE.md |
| Integration, ONE test, gate `AGENT_MANAGER_INTEGRATION=1` | real `claude` + `hc` + Haiku: X1 create (1 prompt), hc resume (0 prompt, idle), clean exit via `ctrl+c ctrl+c`, X1 resume asking the secret (1 prompt); asserts same id each hop, 1 file, 0 duplicate uuids, no registry file left for the pids, `hc ls --all` has no terminal of the test after `hc rm`. Gate on and `hc` or `claude` missing: FAIL, never skip |

## Scope recommendation

1. First: readiness classifier + colored Adopt button, read-only, no stop (it is useful alone and carries the unknown state). Needs the `run_in_background` / `task-notification` pairing and the `queue-operation` reading added to the transcript core.
2. Second: X1 <-> hc for sessions the manager hosts or sees in an hc terminal, idle or acknowledged, with the verification of the registry entry.
3. Third: external discovered -> X1 (hc terminals first; other terminals by "exit it yourself", kill only behind PIN + typed confirmation); bg flows last (`claude stop`).
4. Do not build "close the user's terminal window" or any pid kill without the process check; implement `procStart` first if kill by pid is ever offered.

## Still unknown (measure before building the matching part)

- Sub-agent in flight, background Bash with `run_in_background`, Monitor, queued user message, pending permission at the moment of a stop in an interactive terminal (each is one prompt; none run here: the budget went to the tool and the round trip).
- What the non-hc terminal window of the user shows after the pid is killed; `Ctrl+C` while busy (interrupt, then exit) ; graceful stop of a bg session with `claude stop`; `bg -> X1`.
- Which component removed the stale registry file of the first killed pid (a14) and when; whether the `.key` file is removed with it.
- Whether `--resume` of an id that is live in a bg or hc process is detected by claude itself when resumed by X1 (`-p`): only a5 for bg is documented.
- macOS and Linux behaviour of `hc kill` (tool children) and of the graceful signals.

## Leftovers

- Prompt 5 of 5 was unplanned: `hc send "/exit"` was mangled by my shell to `C:/Program Files/Git/exit` and ran a model turn (a17). No further model calls were made after it; the final X1 resume was therefore replaced by the idle hc resume (0 prompt) for the last hop.
- `~/.claude.json` has `projects["C:/Users/Wadeck/AppData/Local/Temp/am-adopt/proj"].hasTrustDialogAccepted = true` (set by `hc keys down enter`); not removed (user config).
- Removal blocked by the `w-guardrails` rm rule (not worked around): `~/.claude/sessions/37480.json` and `~/.claude/sessions/37480.*.key` (stale files of my killed pid), `~/.claude/projects/C--Users-Wadeck-AppData-Local-Temp-am-adopt-proj/` (transcript, `memory/`), `%TEMP%\am-adopt\` if it is also refused. hc terminals t25, t26, t27 were removed with `hc rm`; `hc ls --all` lists none named am-adopt.

## Phase 1-2 measurements (2026-11-21, implementation)

- Queue pairing: `queue-operation` enqueue/dequeue/remove balance as a FIFO count over the local transcripts (9203 of 9246 sessions balanced); dequeue carries no id, so only a count is possible.
- Background calls: 94% of Bash and 81% of Monitor background calls are closed by a task-notification naming `<tool-use-id>` with a final status (completed, failed, killed, stopped); the rest stay open forever, so an open one is a warning, not a proof.
- `hc get <t>` fields used: `state`, `status`, `finished_ms`, `exit_code`, `reason` (`killed` after `hc kill`), `foreground.pid`; an unknown terminal is `not_found`.
- Integration run (`SessionHost.switch.integration.test.ts`): Web -> hc -> Web kept the id, one transcript, 0 duplicated uuids; the switch removes the finished terminal itself. Needs the real registry folder passed explicitly (`AGENT_MANAGER_SESSIONS_DIR`: `os.homedir()` follows the redirected test profile) and an `HcControl` next to a custom `HcLauncher`.
- Trust: only the folder's own `projects[<path>].hasTrustDialogAccepted` is trusted; the trust of a parent folder was NOT measured, so it is reported as inherited and refused for an hc target unless forced.
- Prompt box (`hc read --json`, field `text`), Claude Code 2.1.325 resumed idle: the last `>`-mark line right under a horizontal rule is the prompt; empty reads `draft: ""` (probe on a resumed session, no model prompt). A draft would make `ctrl+c ctrl+c` clear the text instead of exiting.
- Cost of the implementation session: 3 Haiku prompts (two runs failed at setup, before any switch, after one prompt each).
