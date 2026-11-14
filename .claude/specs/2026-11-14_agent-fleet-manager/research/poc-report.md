# PoC -- reply transports into a live Claude Code session

Date: 2026-11-14. Run by a sub-agent (scripts `poc/scripts/`, raw data `poc/results/`); every number below re-read from the raw JSON and `node scripts/summarize.js` by a second agent.
Status: measurements are [V] unless marked "agent report" or "inference". Headless sessions only. (The tool refused to write `poc/REPORT.md` for a sub-agent; this file replaces it.)

## Conclusion

On Claude Code 2.1.325 all three tested transports wake an idle session. The socket sender has no resident cost, `asyncRewake` costs ~+45 MB private and +4 processes per session, the blocking Stop hook holds the turn open. An image block over the socket was ignored; an image path in text worked 3/3.

## Setup (all tests)

| Item | Value |
|---|---|
| Claude Code | 2.1.325 |
| Model | `--model haiku` (Haiku 4.5 on Bedrock, agent report) |
| Command | `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --session-id <uuid> --model haiku --max-budget-usd 1 --max-turns 6 --permission-mode default --settings poc/results/settings-<test>.json` (T2 adds `--allowedTools Read`) -- `poc/results/spawned.json` |
| Settings | `crossSessionInbound: "accept"`; plugins w-warp, w-command-log, w-block-worktree, w-guardrails, w-roles disabled for the PoC sessions only (`settings-t3.json`); the user's PreToolUse and herdr SessionStart hooks still ran (agent report) |
| Harness | `lib.js` (spawn, registry, `observeTurn`), `sender.js`, `waiter.js`, `hotwait.js`, tests `t1.js`..`t6.js`; invocation not recorded in the results, run from `poc/` |
| Budget | 24 of 30 model turns (agent report); max 2 sessions alive; all pids in `spawned.json` |

## T1 -- socket sender wakes an idle session (n=5) [V]

| Metric (ms) | min | median | max |
|---|---|---|---|
| Send -> first stream event (`command_lifecycle`) | 325 | 331 | 446 |
| Send -> first assistant event | 1089 | 1155 | 2296 |
| Send -> `result` | 1132 | 1170 | 2316 |
| Send -> transcript growth | 1113 | 1166 | 2316 |
| Sender wall time with 300 ms grace | 311 | 318 | 329 |
| Sender wall time without grace | 7 | 8 | 12 |
| Sender peak RSS (KB) | 69180 | 69224 | 69376 |

- 5/5 answered. Frame 123 bytes. Registry keys include `procStart`, `startedAt`, `messagingSocketPath`.
- Idle session, no extra process: 2 processes (claude.exe + conhost.exe), 436 MB private, 229 MB working set (one sample).
- Transcript growth coincides with the assistant event; it is not an early signal.

## T2 -- image by path, and an image-block frame

Image by path (n=3, `--allowedTools Read`) [V]:

| Run | Answer | Correct | Tool | tool_use at (ms) | result (ms) |
|---|---|---|---|---|---|
| 1 | Magenta | yes | Read | 1392 | 2143 |
| 2 | Orange | yes | Read | 1329 | 2084 |
| 3 | Cyan | yes | Read | 1159 | 1990 |

- Text-only baseline (n=2, "Blue."): result 2426 and 1524 ms; too noisy to compare.
- tool_use -> result: 751 / 755 / 831 ms.
- Block-array frame (1 attempt, 496 bytes, text + base64 image): ignored; empty timeline in the 40 s window (`t2.js:63`) [V raw JSON]. Why it was ignored: unknown.

## T3 -- asyncRewake hook (`timeout` 20 s)

Wakes (n=3) [V]:

| Metric (ms) | min | median | max |
|---|---|---|---|
| File written -> waiter detects | 69 | 94 | 139 |
| File written -> first stream event | 101 | 117 | 163 |
| File written -> `result` | 1206 | 1289 | 2329 |
| Waiter peak RSS (KB) | 67704 | 67728 | 67848 |

- Wake 1 armed by SessionStart; wakes 2 and 3 armed by the Stop hook of the previous wake turn. All answered.
- Waiter CPU 15-30 ms. Armed tree: claude.exe, conhost, bash, conhost, bash, node (node 66 MB working set, 19 MB private) = 4 extra processes.
- Expiry (n=1) [V]: waiter dead after 20209 ms with no stream event; a file written afterwards did not start a turn within 8 s; a socket message did (result 1669 ms); the Stop hook of that turn started a new waiter 1398 ms after the result; the stale file was consumed 2004 ms after the send and answered late (`ack-T3-sock | ack-T3-stale`).
- Inference: a file mailbox needs expiry or acknowledgement, or a stale reply is delivered late.

## T4 -- blocking Stop hook hot-wait (`timeout` 30 s, wait 15 s)

Continuations (n=3) [V]:

| Metric (ms) | min | median | max |
|---|---|---|---|
| File written -> hook detects | 45 | 170 | 200 |
| File written -> first event (`user`) | 56 | 181 | 212 |
| File written -> assistant answer | 966 | 1286 | 1316 |
| Hook RSS (KB) | 67648 | 67748 | 67852 |

- `stop_hook_active`: false on the first Stop, true on every Stop after a continuation (3/3).
- Expiry (n=2) [V]: waited 15027 and 15049 ms, then the session went idle (registry `idle`, alive). `result/success` arrives only after the hook ends (`resultEventToHookStartMs` -15060), so a hot-wait turn looks longer by the wait.
- Each Stop starts a new hook process (distinct pids in `hookLog`).
- A first run is kept as `t4-run1-harness-flaw.json`, excluded from the numbers (flaw nature: agent report only).

## T5 -- idle footprint with and without the waiter [V]

| Sessions | Waiter | Private MB each | Working set MB each | Processes each |
|---|---|---|---|---|
| 1 | no | 419 | 226 | 2 |
| 1 | yes | 469 | 320 | 6 |
| 2 | no | 428 / 444 | 226 / 230 | 2 |
| 2 | yes | 472 / 487 | 319 / 322 | 6 |

- Delta: +50 MB private (n=1), +44 / +43 (n=2); working set +94, +93 / +92. Extrapolating to 10 sessions (~+0.5 GB private, +40 processes) is arithmetic, not measured.
- With-waiter runs recorded `exitCodes: [null]` and `leftoverWaiterPids` 48864 and 47300 (how those sessions were ended is not recorded). The lead later found no such process (`tasklist`, `scripts/alive.js`).

## T6 -- exit with an armed waiter (n=2 each) [V]

| Waiter | Exit after stdin close (ms) | Waiter gone after (ms) |
|---|---|---|
| no | 110, 110 | - |
| yes | 31597, 31593 | 30181, 30293 |

An armed waiter delays session exit by ~30 s. Cause unknown.

## Measurement vs inference

| Claim | Kind |
|---|---|
| Latencies, RSS, process counts | Measurement (small n, one machine, one model, headless) |
| Image block ignored | Measurement, n=1 |
| 10-session asyncRewake cost | Inference (arithmetic) |
| Stale-file late delivery needs expiry/ack | Inference from one run |
| Interactive sessions behave like headless | Inference, untested |

## Discrepancy against the sub-agent's chat summary

- "Read round trip, tool_use to result, 751 to 831 ms": numbers right, label wrong. The span runs from the assistant `tool_use` event to the final `result`, so it includes the second model call. In the sample timeline the tool_result arrives 33 ms after the tool_use (1392 -> 1425 ms) and the next message starts at 2136 ms. It is not a pure Read cost.
- All other numbers (T1, T3, T4, T5, T6) match the raw JSON.

## Not tested

Interactive (non `-p`) sessions, plain `async: true`, default 600 s hook timeout, SessionStart re-fire on resume/compact, the 8-continuation cap, more than 2 concurrent sessions, herdr/Windows Terminal panes, the queue mod path, behaviour under load.

## Blocked during the run

Two Bash calls were refused by w-guardrails and not bypassed: an inline `node -e` and an `rm` of a temporary patch script (agent report). Nothing was deleted.
