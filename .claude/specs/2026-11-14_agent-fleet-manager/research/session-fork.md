# Forking a session, branching at a message, and the mini-fork (side thread)

Date: 2026-11-21. Windows 10, Bedrock, Haiku, `claude` 2.1.330 (read-only `--help` and binary scan). 4 Haiku prompts in total, one process at a time, no loops.
Marks: [D] official doc fetched 2026-11-21 (code.claude.com: `agent-sdk/sessions`, `agent-sdk/file-checkpointing`, `agent-sdk/typescript`, `cli-reference`), [M] measured now, [B] read in the installed binary (strings only, nothing run), [R] read in this repo, [U] unknown.
Scripts: `poc/scripts/fork-test.mjs` (phases `create`, `full`, `at`, `dump`), `poc/scripts/fork-idprobe.mjs` (no model call). Folder: `%TEMP%\am-fork` (not trusted: `-p` shows no trust dialog [D], see session-launch-options.md).

## Conclusion

1. Fork = `claude -p --resume <source> --fork-session [--session-id <new uuid>]`. The fork gets a copy of the history under a new id, the source file is byte-identical afterwards [M]. `--session-id` with `--resume` is accepted only together with `--fork-session` [M][B], so agent-manager can choose the id of the fork before the first message.
2. Branching at a message exists in the CLI as a hidden, print-mode-only flag `--resume-session-at <message id>` [B] (absent from `claude --help`, documented only as the SDK option `resumeSessionAt` and the function `forkSession(id, {upToMessageId})` [D]). With `--resume --fork-session`, the fork stops at that entry and the later messages are gone from it [M].
3. File changes are NOT forked: the sessions page says so [D]. `rewind_files` (stream-json control request) and `--rewind-files <user-message-id>` exist, need file checkpointing enabled at the START of the session, and a fork does not carry the original's checkpoints [D]. Not usable for existing sessions.
4. agent-manager log rows carry no transcript `uuid` today (`EntryBase` has `key` and `offset` only) [R]: a thread anchored on a row needs the uuid added to the entries.

## Facts

| # | Fact | Mark |
|---|---|---|
| a1 | `--fork-session`: "When resuming, create a new session ID instead of reusing the original (use with `--resume` or `--continue`)" | [D] [M] |
| a2 | Fork creates a new session that starts with a copy of the original's history; the original's ID and history stay unchanged | [D] |
| a3 | Source transcript before/after a fork and a branch: same sha256 prefix `c519298de29e986a`, same 302943 bytes | [M] |
| a4 | The fork asked what the secret words were: `ALPHA, BRAVO` (full fork, `-p --resume S --fork-session`, new id `fe43e85f-7b6e-42a3-8f49-17cc5064cf39`) | [M] |
| a5 | In the fork transcript the copied entries keep their `uuid` and `parentUuid`; only `sessionId` is rewritten to the new id | [M] |
| a6 | The fork transcript has NO field naming the source (no `forkedFrom` in either fork file); the link exists only in what agent-manager records | [M] |
| a7 | The fork transcript file is not created before the first message (stream-json fork, stdin closed after 4 s: process exit 0, no `<newId>.jsonl`) | [M] |
| a8 | `SessionStart` hooks run for a fork with `hook_name` `SessionStart:fork` (source `fork`) | [M] |
| a9 | `--session-id X` with `--resume` and without `--fork-session`: exit 1, `Error: --session-id with --continue or --resume also needs --fork-session.` | [M] |
| a10 | `--resume <unknown id>` in stream-json: exit 1, stderr `No conversation found with session ID: <id>`, stdout one `result` `error_during_execution` | [M] |
| a11 | With `--fork-session --session-id <new>` the stream-json frames carry `session_id` = the chosen id from the first line (hook_started) | [M] |
| a12 | Transcripts live under `~/.claude/projects/<encoded cwd>/<id>.jsonl`; resume looks the id up beyond the current project folder since v2.1.223, same machine only | [D] |
| a13 | The fork launched from the folder of the source wrote its transcript in that folder's project directory | [M] |
| a14 | Fork from ANOTHER cwd: where the transcript goes and what the agent sees as cwd | [U] (agent-manager always forks in the cwd of the source) |
| a15 | Model and permission mode of a fork when no flag is given | [U]; `--resume --bg` re-applied the user's defaults rather than the launch flags (session-launch-options.md) [M], so agent-manager passes both explicitly |
| a16 | Fork of a source that is a bg or hc transcript (not a stream-json one) | [U] not run; the transcript format is the same file, the fork only reads it |
| a17 | Fork of a source that is mid-turn: fork content | [U]; the transcript as written so far is what is copied (behaviour, not measured) |
| b1 | SDK `resumeSessionAt`: "Resume session at a specific message UUID"; `forkSession(sessionId, {upToMessageId, title, dir})` copies "up to and including the message with this `uuid`: a value from `getSessionMessages()`, or a `uuid` you set on a streamed `SDKUserMessage`"; throws when the id matches no message | [D] |
| b2 | CLI: `--resume-session-at <message id>`: "When resuming, only messages up to and including the chain entry with <message.id>. Any chain-entry UUID, typically the kept turn's last entry (use with --resume in print mode)"; `--resume-drops-turn <message id>` declares the prompt uuid of the discarded turn, the resume is refused if the discarded range holds anything not attributable to it; both "ignored outside print mode" | [B] (v2.1.330) |
| b3 | Branch run: `claude -p --resume S --fork-session --resume-session-at 27bf9648-39df-453b-bd04-99816f5c1819 "<question>"` (27bf9648 = the assistant text entry `OK1` of turn 1). Answer `ALPHA`; the fork transcript (`282423fd-d386-4463-a812-c7c9b1c3e767`) has 0 occurrence of `BRAVO`; the new user message has `parentUuid` 27bf9648 | [M] |
| b4 | No `--resume-drops-turn` was needed for this branch (no queued message in the dropped range) | [M] |
| b5 | Anchor = a user message uuid (the first prompt of the dropped turn, or the kept user prompt): not run | [U] |
| b6 | Anchor in the middle of a turn (between a `tool_use` and its `tool_result`): not run, the CLI text says "typically the kept turn's last entry" | [U] |
| c1 | `rewind_files` is a control request subtype in the binary (not run); the CLI flag is `--rewind-files <user-message-id>` (needs `--resume`, prints `Files rewound to state at message <uuid>` and exits) | [B] [D] |
| c2 | Checkpointing needs `enableFileCheckpointing` (SDK) or the env `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true` for bare `claude -p`; `--replay-user-messages` returns the checkpoint uuids; "Checkpoints are tied to the session that created them"; tracks Write, Edit, NotebookEdit only (not Bash, not subagents) | [D] |
| c3 | The fork does not include the original's file checkpoints | [D] |
| c4 | The daemon passes `--replay-user-messages` already; the file-checkpointing env is not set, so no existing owned session has checkpoints | [R] |
| d1 | A user line has `uuid` and `parentUuid` (null for the first); each content block of one assistant message is its own line with its own uuid (turn 1: a `thinking` line 15334064, then the `text` line 27bf9648); `attachment` lines sit between and after (e.g. c7d8963d after OK1), all chained by `parentUuid` | [M] |
| d2 | A message sent on stream-json stdin with a client `uuid` is the `uuid` of its user line in the transcript (`ab0b1437-...` sent, same in the file) | [M] |
| d3 | The UI entries (`EntryBase`: `key` = `<offset>.<n>`, `offset`) do not expose the line `uuid` / `parentUuid` | [R] |

## The live sequence (4 prompts)

| Step | Command | Result |
|---|---|---|
| 1 and 2 | `node fork-test.mjs create %TEMP%/am-fork`: one stream-json process, 2 messages ("first secret word is ALPHA ... reply OK1", "another secret word is BRAVO ... reply OK2") | session `6616470e-3cd3-4100-b492-74f4bf302d84`, both `result` success, 302943 bytes |
| 3 | `node fork-test.mjs full ... 6616470e-...` = `claude -p --output-format json --model haiku --setting-sources project --permission-mode default --resume 6616470e-... --fork-session "<list the secret words>"` | `ALPHA, BRAVO`; fork `fe43e85f-...`; source unchanged |
| 4 | `node fork-test.mjs at ... 6616470e-... 27bf9648-...` (adds `--resume-session-at 27bf9648-...`) | `ALPHA`; fork `282423fd-...` without BRAVO; source unchanged |
| 0 prompt | `node fork-idprobe.mjs` three runs: `--resume S --fork-session --session-id N` (exit 0, session_id N, no transcript yet), same without `--fork-session` (exit 1, a9), unknown source (exit 1, a10) | see a7, a9, a10, a11 |

## What was built (fork of an owned or discovered session)

- Core: `buildStreamJsonArgs({forkOf, sessionId})` gives `--resume <src> --fork-session --session-id <new>` (the id is generated by the child start, so the host knows it before the first message). `parseLaunchBody` accepts `forkOf` (UUID, stream-json only, `fork-host-unsupported` otherwise). `SessionHost.launch` checks the source transcript exists first (`transcriptPath`, `fork-source-not-found` with the fix), records `forkedFrom` in `owned-sessions.json` (additive field), the event `session.launched` and the audit line (`forkOf`).
- Daemon: `POST /sessions/launch` takes `forkOf` (404 `fork-source-not-found`, 400 `invalid-fork-source`, 400 `fork-host-unsupported`). Nothing else changed.
- Module: `POST /owned/fork {sourceSessionId, name?, model?, permissionMode?}`, sensitive (PIN) in `routeClasses.ts`. Source = any session of the list (owned of any host, or discovered); folder = its cwd; name `fork of <name>`; model and mode default to the record of an owned source, else Claude Code decides.
- UI: Fork button in the detail header (disabled with the reason for a session that has no message yet), `ForkDialog` (name, model, mode; warning when the source is working), `forkedFrom` on the row and "forked from <name>" in the header (link to the source when listed).
- A bg or hc source is allowed (only its transcript is read); the fork itself is always a Web session. A bg or hc FORK is not offered (a16: no measurement).

## Mini-fork / side thread

Wanted: from one message of the log, open a small thread on the side that has the context up to that message, without disturbing the main session. Design only, nothing built.

### What the platform gives

- A real branch at a message: `--resume <id> --fork-session --resume-session-at <uuid>` in print mode (b2, b3 [M]). The branch is a full session (own transcript, own claude process, own `--permission-prompt-tool stdio` host).
- A fork at the end of the transcript plus the quoted message as the first prompt: works with measured features only (a4), loses nothing but "the agent knows only what happened up to that message".
- Not given: a thread as a native object (no parent link in the fork transcript, a6), file isolation (c3, a2), a way to merge back (no API; a summary written by the thread and sent as a message to the parent is the only way, through the existing reply transports).

### Shape

- Anchor: the transcript `uuid` of the LAST chain entry of the message's turn (b2). A user row: the uuid of the user line (d2: known from the send for web replies). An assistant row: the uuid of its last content block line (d1). Needs `uuid` added to `EntryBase` (d3), additive.
- A thread is an owned X1 session with `forkedFrom` (built) plus `threadOf: {sessionId, anchorUuid, quote}` stored in `owned-sessions.json` (same additive style) and in the user state file next to the groups (`agents-user-state.json`, `UserGroup` neighbours) only for presentation (collapsed, order); the daemon record stays the source of truth for the process.
- UI: a "Thread" action on a log row opens a side panel (the sub-agent panel slot, `SubagentAside`) with the thread's own log and composer, the quoted message on top, a chip on the anchored row ("2 replies") and the thread listed under its parent in the Tree mode. Close = stop the process, keep the record (resumable). Discard = stop and forget (transcript stays on disk, as Forget does today). Merge back = a button "Send summary to the parent": asks the thread (one prompt) for a short summary and posts it to the parent through the reply route, PIN-gated, text editable before sending.
- Limits: one claude process per live thread (about 450 MB private each [M, session-launch-options.md]); cap `maxThreadsPerSession` (default 2) and the existing `maxLiveSessions`; refuse with the count and the fix, never queue silently.

### Options

| Option | How | Pros | Cons |
|---|---|---|---|
| A. Branch at the message | `--fork-session --resume-session-at <anchor>` | The thread sees exactly the context up to the message ("using the context"), later turns of the parent are absent: small context, no confusion | Hidden CLI flag [B]: may change without notice; print mode only (fine for X1); anchor rules for mid-turn entries unknown (b6): the UI must anchor on turn ends only; needs `uuid` on entries |
| B. Fork at the end plus a quoted message | normal fork (built), first prompt "Context: the message below (uuid ...) from the earlier conversation: <quote>. Answer only about it." | Uses only documented and measured behaviour; no anchor rules; works for bg and hc transcripts | The thread knows the whole later conversation (bigger context, answers may leak later decisions); the quote is a convention the model may ignore |
| C. No fork: fresh session with a digest | new X1 session, first prompt = quote plus a summary of the last N entries | No dependency on forking, cheapest context | Loses the real context, which is the point of the request; summary quality decides |

Recommendation: A for sessions that are X1 or discovered with a transcript, B as the explicit fallback when the anchor is not a turn end or the flag is refused (the refusal is shown, not hidden). Build B first (it is the fork already shipped plus a quote and the thread UI), add A once `uuid` is on the entries and b5/b6 are measured (2 more prompts).

### Risks

- The hidden flag (b2): a CLI update can change it. Guard: check at launch that the fork's `system/init` reports the chosen `session_id` and that its transcript has no entry after the anchor; otherwise stop the thread and say so.
- Files are shared (a2, c3): a thread that edits files edits the parent's folder. The panel must say so; a worktree option is out of scope here.
- Cost: every thread is a paid conversation with the parent's whole context re-read (prompt cache may help: [U]).
- A thread on a message of a session still running: same warning as the fork (a17).
- Threat model: starting a process is already PIN-sensitive (`POST /owned/fork`); a thread route would be the same class. The quote travels in a prompt: it can hold anything the log held (no new exposure, same user).

### Missing from the platform

- A parent link in the transcript of a fork (a6) and a documented CLI flag for branching at a message (b2).
- Any merge-back primitive.
- Measurements still owed before building A: anchor on a user uuid (b5), anchor mid-turn (b6), fork from another cwd (a14), model/mode inheritance without flags (a15), fork of a bg or hc transcript (a16): at most 5 prompts, each on its own request.

## Decisions to log (proposed, numbers left to the spec owner)

1. A fork is always a Web session (X1) launched by the daemon with `--resume <src> --fork-session --session-id <new>`; source of any host; same cwd; model and mode passed explicitly.
2. `POST /owned/fork` is PIN-sensitive; `forkOf` is also accepted by `POST /owned/launch` and `POST /sessions/launch` (same checks).
3. The link fork -> source lives in `owned-sessions.json` (`forkedFrom`), not in the transcript (a6).
4. The mini-fork is design only; the user chooses between A, B and C.
