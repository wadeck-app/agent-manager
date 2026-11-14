# M0 measurements (first batch)

Date: 2026-11-14. Gathered by a sub-agent; raw files in `poc/results/` (`hook-durations.json`, `node-cold-start.json`, `m0-d1-dedupe.json`, `m0-d2-priority.json`, `m0-summary.json`, `registry-watch.ndjson`).
Status: [V] = lead re-read the raw JSON. Everything else is agent report. Claude Code 2.1.325, Windows, node v24.22.1, ~14 live sessions (noise).

## A. Real hook durations (transcript `hook_success.durationMs`) -- agent report

18 of the 40 most recent transcripts (100 MB cap), all written in one 14-minute window: live sessions only, node-based hooks only (no powershell/bash split possible), failed and async hooks not counted.

| Event | Hook | n | median ms | p95 ms | max ms |
|---|---|---|---|---|---|
| PostToolUse | on-post-tool-use.js | 1933 | 110 | 559 | 7303 |
| Stop | on-stop.js | 180 | 520 | 1285 | 14868 |
| PreToolUse | PreBashForbiddenCommands.js | 62 | 83 | 109 | 520 |
| PreToolUse | pre-tool-use.js (w-guardrails) | 60 | 118 | 206 | 936 |
| SessionStart | on-session-start.js | 2 | 147 | 239 | 239 |

The independent review measured a PostToolUse median of 145 ms on another sample: same order of magnitude.

## B. Node cold start on Windows -- [V] (raw JSON)

| Variant | n | min ms | median ms | p95 ms | max ms |
|---|---|---|---|---|---|
| empty hook `node empty-hook.cjs` (1 KB stdin) | 20 | 42.9 | 45.1 | 54.8 | 67.1 |
| bundle `node agent-manager.cjs -v` | 10 | 57.6 | 62.9 | 70.6 | 70.6 |
| global shim `agent-manager -v` (cmd.exe + .cmd + node) | 10 | 453.7 | 502.8 | 745 | 745 |

The npm shim costs ~8-11x the direct node call: hooks must call `node <abs>/hook.cjs` (decision 29, now measured). Peak RSS of the empty hook: 67.6 MB (one run). Not measured: CPU time, shim breakdown.

## D. Socket frame fields (2 headless sessions, Haiku, n=1 each) -- D1 [V]

- `msg_id` does not dedupe: a full frame (`msgV:1`, `msg_id`, `priority`, `session_id`) sent twice 200 ms apart gave 2 user lines and 2 turns (`resultsAfterWait: 2`, `userLinesWithMarker: 2`).
- Priority (agent report, suggestive only): `now` aborted the running tool call ("Command was aborted before completion"), injected the message, the model resumed; `next` delivered after the current tool call and before the next one; `later` ran as its own extra turn after the turn ended. The model ignored the payload each time (untrusted peer message), so effect is read from the transcript, not from the answer.
- The `next` injected line did not appear among the parsed user lines; only the model's remark shows delivery.

## C. Registry watcher

`poc/scripts/registry-watch.js` (pid in `spawned.json`) logs status transitions to `poc/results/registry-watch.ndjson` (43 lines in the first 3 minutes, 23 change events) to answer "does `status` change during a permission dialog?" by correlating with w-warp PermissionRequest logs later. Stop it with `poc/results/registry-watch.stop`.

## Not done

Interactive-session checks, registry status during a permission dialog (collecting), process start time reading, detached-daemon survival and console flash, plain `async: true`, hook timeout behaviour, transcript growth per async hook.
