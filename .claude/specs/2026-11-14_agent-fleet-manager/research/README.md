# Research index -- Agent Fleet Manager

Date: 2026-11-14. Gathered by sub-agents (market, sibling CLIs, app-core, hooks, herdr, agent-fleet, PoC) and re-read in part by the lead.
Status: each file marks claims `[V]` (lead re-read the source), `agent report` (unverified) or `UNVERIFIED`.

| File | Contents |
|---|---|
| `market-landscape.md` | Survey of fleet-management tools, 4 state-capture approaches, UX ideas, gaps |
| `sibling-clis.md` | queue / task / project patterns to reuse |
| `app-core.md` | app-module contract, push/SSE limits, guard, A/B facility |
| `claude-code-hooks-and-transcripts.md` | Hook events, return values, session registry, transcripts, local hooks/plugins, w-guardrails bypass protocol |
| `reply-transports.md` | Every way to deliver a typed reply into a live session, compared; owner answers; user decisions |
| `w-warp-herdr-hooks.md` | What the existing w-warp and herdr hooks read, map to state, and get wrong (sub-agent attribution, blocked-state gap, sleeps); copy/change list |
| `design-review-1.md` | Independent review of the design (20 findings R-01..R-20: hook volume, registry as primary source, loopback injection, upload limits, delivery hints, stale docs); dispositions point to decisions 29-41 |
| `agent-fleet-reuse.md` | Ranked reusable code and UX from the agent-fleet repo |
| `poc-report.md` | PoC measurements on Claude Code 2.1.325 (socket, asyncRewake, Stop hot-wait, image by path, footprint); replaces `poc/REPORT.md`, which the tool refused to write for a sub-agent |
| `permission-prompt-remote-answer.md` | How to answer a pending permission prompt from another process: `hc keys` (herdr-core, proven), PermissionRequest hook (proven, future prompts), inbox socket frames (none), Remote Control/Channels (not on Bedrock); ranked, with measurements |
| `hc-keys-approval.md` | Keys measured on the real dialog (enter = allow once, esc = deny, same as option 3), dialog layout, trust-dialog trap, live test of HcLauncher + HcApproval |
| `../../../../poc/` | PoC scripts (`scripts/`) and raw results (`results/*.json`); not specs, delete only after the lead's cleanup request |

## How to re-verify

- Local files: re-read the cited `file:line`; `[V]` means the lead already did.
- Measurements: `cd poc && node scripts/summarize.js` prints min/median/max from `results/`.
- Hooks and Claude Code docs: https://code.claude.com/docs/en/hooks (the agent read only the first 100k of 293k chars), `.../terminal-config.md`, `.../common-workflows`, `.../remote-control.md`, channels docs.
- Anything marked `agent report` or `UNVERIFIED` must be re-read before it drives a decision.
- [m0-measurements.md](m0-measurements.md) -- first M0 batch: real hook durations, node cold start (shim 503 ms vs direct 45-63 ms), socket msg_id and priority; raw files in poc/results
- [ui-inspiration.md](ui-inspiration.md) -- herdr Agents panel (image + docs), survey of 20+ interfaces with V/P/U marks, state model implied by herdr, variant concepts A-J, recommendation; reference image in assets/herdr-agents-panel.png
- [reply-wrapper-and-user-origin.md](reply-wrapper-and-user-origin.md) -- why socket replies arrive as "Another Claude session sent a message" (hard-coded peer origin, binary offsets), `hc send` as a typed human prompt (transcript compare, dialog refusal, busy queueing), UUID msg_id as delivery key, ranked options
- [statusline-data-in-transcripts.md](statusline-data-in-transcripts.md) -- model attachment, `/model` stdout, usage fields, how each statusline field is derived (exact vs estimate), context window evidence per model, model id forms
- [hc-transport.md](hc-transport.md) -- the `hc` reply transport: hc CLI shapes and errors, session to terminal mapping (foreground pid), what was proven with a real terminal and what only with fakes
- [session-launch-options.md](session-launch-options.md) -- launching sessions ourselves: stream-json child (stays open, structured events, image, control_request allow/deny, dies with its owner), `claude --bg` (supervisor, registry kind bg, private control-pipe reply, attach-only permissions), hc, own ConPTY; agent-fleet launcher facts; ranked, with exact frames and timings
- [session-fork.md](session-fork.md) -- forking a session (`--resume --fork-session --session-id`), branching at a message (hidden `--resume-session-at`), file checkpoints, transcript uuids; the live 4-prompt sequence; what was built for Fork; design and options of the mini-fork / side thread
- [adopt-host-switch.md](adopt-host-switch.md) -- switching the host of one session (#71): same id and one transcript over X1 -> hc -> X1 -> hc, what each stop leaves (stale registry file, orphan tool child, terminal), clean exit by `ctrl+c ctrl+c`, readiness rule (free / busy-warning / unknown) for the Adopt button, flows, TDD plan
