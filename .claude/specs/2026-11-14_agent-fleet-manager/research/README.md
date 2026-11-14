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
| `../../../../poc/` | PoC scripts (`scripts/`) and raw results (`results/*.json`); not specs, delete only after the lead's cleanup request |

## How to re-verify

- Local files: re-read the cited `file:line`; `[V]` means the lead already did.
- Measurements: `cd poc && node scripts/summarize.js` prints min/median/max from `results/`.
- Hooks and Claude Code docs: https://code.claude.com/docs/en/hooks (the agent read only the first 100k of 293k chars), `.../terminal-config.md`, `.../common-workflows`, `.../remote-control.md`, channels docs.
- Anything marked `agent report` or `UNVERIFIED` must be re-read before it drives a decision.
