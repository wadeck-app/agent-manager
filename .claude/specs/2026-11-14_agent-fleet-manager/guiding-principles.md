# Guiding Principles -- Agent Fleet Manager

Any option that conflicts with a principle must be raised as an open question, never silently accepted.

## Principles

### P-1: UX first
Best-in-class UX is the top priority; UI variants are validated through the app-core A/B facility on the real page.
**Why:** user's global rule (UX/DX first) and the explicit request for "the best UX in the world".

### P-2: No silent failure
Missing configuration or a failed hook produces an explicit, actionable warning or error.
**Why:** user's global rule (no silence, no silent fallback).

### P-3: Reuse sibling patterns
CLI, daemon and app-module structure follow `queue`, `task`, `project` and app-core unless evidence says otherwise.
**Why:** stated in the request.

### P-4: Harness-agnostic core
The core model (agent, session, event, tool call, sub-agent) must not be Claude-specific; Claude Code is the first adapter.
**Why:** v4 targets OpenCode and Codex.
