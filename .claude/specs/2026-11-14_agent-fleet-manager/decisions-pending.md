# Pending decisions -- Agent Fleet Manager

## D-B. Protection of the reply route against other agents (Q8, from R-03)

**Context:** app-core has no authentication, so any agent's Bash tool can `curl http://127.0.0.1:4850/api/modules/agent-manager/<reply route>` and type into another session, possibly one running in bypass-permissions mode. This path is cheaper than the socket, which needs the session token files. A rule in w-guardrails (another repo) could deny such calls.
**Facts:** [V by reviewer] the app-core guard lets requests without `Sec-Fetch-Site` or `Origin` through (`requestGuard.ts:51-69`); UNVERIFIED whether w-guardrails already blocks curl to loopback.
**Options:**
- A: app-core guard plus `Sec-Fetch-Site: same-origin` and a per-page CSRF header on mutating routes only (already in decision 31). Pro: no cross-repo work. Con: a same-user process can still fetch the page and read the CSRF value. Security: residual T-08.
- B: A plus a w-guardrails rule denying curl/wget/fetch to `127.0.0.1:4850/api/modules/agent-manager`. Pro: blocks the cheap agent path at the source. Con: cross-repo change to w-guardrails (owner: claude-plugin-owner), and a determined agent can use node `http`. Security: lowers T-08 further, not to zero.
- C: B plus a per-reply confirmation click in the UI. Pro: strongest. Con: friction on every reply (conflicts with P-1).
**Recommendation:** B.
**Unblocks:** closing T-08; no code is blocked (A is implemented either way).

## D-A. Reply transports (Q1, revised after research)

**Context:** The web UI must deliver typed replies and pasted images to live sessions, idle ones included, for 10+ concurrent sessions. User rejected headless `--resume`, wants several transports measured side by side.
**Facts:** see evidence.md (socket: wakes idle, zero resident cost, private protocol, no ack, text only; `asyncRewake` hook: documented wake, one background process per session, re-arm unverified; blocking Stop hook: documented, holds the turn open up to the timeout; channels: research preview, one MCP process per session; herdr socket: only panes inside herdr, images by path).
**Options:**
- A: socket only.
- B: pluggable `ReplyTransport`, socket default, hook-based fallbacks (hot-wait Stop hook, asyncRewake) in v1.
- C: B plus herdr and channels adapters in v1.
**Recommendation:** B.
**Image handling (proposed, not decided):** daemon stores the pasted image under `~/.config/agent-manager/uploads/` and the message carries its path.
**Unblocks:** Q4, benchmark plan (needs user approval before any run).
