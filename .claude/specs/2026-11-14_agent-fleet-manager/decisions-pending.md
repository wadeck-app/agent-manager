# Pending decisions -- Agent Fleet Manager

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
