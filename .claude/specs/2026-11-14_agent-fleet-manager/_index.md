# Spec: Agent Fleet Manager

**Created:** 2026-11-14
**Version:** v0.1
**Status:** In Review -- v0.2 -- 7/7 questions resolved (4 provisional); `architecture.md` and the v1 plan written, awaiting user review
**Iteration:** 1

## Summary

A CLI (`agent-manager`, name TBC) wired into Claude Code global hooks, feeding a web UI (app-core app-module) that shows the state of all agents, lets the user browse logs with collapsed tool calls, reply to agents, and follow sub-agents. Later: w-guardrails bypass management (v2), structured-question MCP server (v3), OpenCode/Codex adapters (v4). Patterns follow the sibling CLIs `queue`, `task`, `project`.

## Phasing

| Phase | Scope | Status |
|---|---|---|
| v1 | Claude Code hooks -> CLI -> daemon -> web UI: agent state, log browsing, collapsed tools, reply, sub-agent tracking, A/B UI variants | Active |
| v2 | Manage w-guardrails permission bypasses from the web UI | Parked |
| v3 | MCP server for structured questions to the user | Parked |
| v4 | OpenCode and Codex adapters | Parked |

## Decision Log

| # | Decision | Status | Date | Rationale |
|---|---|---|---|---|
| 1 | Stack: TypeScript on Node >=22, family-A layout (core/service/cli/sdk/app-module), `singleton-daemon-kit` loopback daemon, app-core module, state under `~/.config/agent-manager` | Derived | 2026-11-14 | Request says follow queue/task/project; user prefers Node |
| 2 | Hooks are thin: `agent-manager hook <event>` forwards stdin to the daemon with a short timeout, never blocks the agent, and logs every failure (surfaced by `doctor`/UI banner) | Derived | 2026-11-14 | Hooks run synchronously (threat T-02); P-2 forbids silence |
| 3 | Transcript JSONL (path given in every hook payload) is the source for log content, tool calls and sub-agents; hooks give live state | Derived | 2026-11-14 | Hooks lack content; transcripts have `tool_use`, `isSidechain`, `agentId` |
| 4 | Not a fork of `agent-fleet`: that repo launches headless workers, this tool observes user-started sessions | Derived | 2026-11-14 | Evidence [V] above; user may overturn |

| 5 | Images in replies travel as a file path in the message text only | Decided | 2026-11-14 | User decision; no documented image route into an existing session |
| 6 | Claude Code channels are not an option (user runs on Bedrock) | Decided | 2026-11-14 | User fact; docs also say channels do not work on Bedrock |
| 7 | Reply transports are pluggable and switchable from the UI: v1 supports every transport that makes sense (socket sender, asyncRewake hook, blocking Stop hook hot-wait, queue mod, herdr adapter), numbers measured before the UI work | Decided | 2026-11-14 | User answer to Open Point #1; headless `--resume` rejected |

| 8 | Live push: one SSE stream from the module backend, "notify then refetch", single refresh source; polling only as the fallback when the stream is down (shown in the UI) | Derived | 2026-11-14 | app-core allows SSE, has no WebSocket API; agent-fleet lesson: two refresh sources corrupt the UI |
| 9 | UI = YAML views for list/overview pages plus custom React `dslLib` components for the log viewer and the reply composer (image paste needs a paste event) | Derived | 2026-11-14 | DSL cannot capture clipboard paste; app-core allows `dslLib` |
| 10 | Every hook payload is stored by reference (session id, transcript path, byte offset); transcripts are read in place, never copied | Derived | 2026-11-14 | Privacy (T-Information Disclosure) and scale with 10+ sessions |

| 11 | app-core runs locally only (loopback); the reply channel is protected by the app-core guard plus an audit log of every web reply (session, time, text, transport) shown in the UI, and a visible origin marker at the start of delivered text | Derived | 2026-11-14 | User fact: app-core is local only, which removes the LAN case; B is the cheap, reversible option; the user did not pick A/B/C explicitly, so this is provisional |
| 12 | Research is persisted under `research/` in the spec folder and `poc/REPORT.md`; every new finding is written there before it is used in a question | Decided | 2026-11-14 | User instruction: documenting research is key |

| 13 | Hooks ship as a Claude Code plugin (`hooks.json` calling `agent-manager hook <event>`), like the existing `w-*` plugins; `agent-manager doctor` and the UI warn explicitly when hooks are missing or when the plugin is older than the CLI | Derived | 2026-11-14 | Established pattern in this install; P-2 (no silence); editing `settings.json` is guarded by w-guardrails |
| 14 | State model derived from hook events: starting, working, waiting-permission, waiting-user, idle, error (StopFailure), ended; sub-agents from SubagentStart/Stop plus `subagents/agent-<id>.jsonl` and `meta.json` | Derived | 2026-11-14 | Event list in research; exact mapping still to be checked on real payloads |

| 15 | Main screen: one page, three layout variants wired into the real page behind the A/B dock: A "needs me" inbox, B fleet board, C session rail + focus pane. Default C, with a "needs me" badge and counter in the rail from day one | Derived | 2026-11-14 | User asked for heavy A/B use and lists state overview, log browsing, replies in that order; choice is reversible through the dock, so no question needed |
| 16 | Observation hooks (all events except the reply hook) run `async: true` so they can never block an agent; only the reply hooks (blocking Stop hot-wait, asyncRewake) are non-plain | Derived | 2026-11-14 | Hooks are synchronous by default (T-02); hook docs (agent report): plain async has no enforced timeout and cannot influence the session. Spawn cost of the hook CLI per event is NOT measured yet |
| 17 | v1 shows transcript content unmasked (local, single user); no secret masking | Derived | 2026-11-14 | User fact: app-core is local only; masking would hide the data the user came to read; revisit with remote access |

| 18 | CLI and package name: `agent-manager` | Decided | 2026-11-14 | User answer |
| 19 | The reply transport is configurable and switchable in one click or key (global default, per-session override, CLI `transports`), each with live measured latency; the default is proposed, not imposed | Decided | 2026-11-14 | User request: switch quickly to see the differences |
| 20 | Repo: `origin` = https://github.com/wadeck-app/agent-manager (exists, empty); the CI publish pipeline is pre-approved by the user | Decided | 2026-11-14 | [V] `git remote -v`, `git ls-remote origin` empty; user: CI approved when the repo and requirements were given |
| 21 | Retention: 90 days and 200 MB per data category (event history, logs, uploads), like queue's history | Derived | 2026-11-14 | User gave 90 d / 200 MB for logs; I extend it to uploads (pasted images saved to disk) |
| 22 | Confirmation window 15 s: after it a reply shows "unconfirmed" (not failed) and keeps being watched; mailbox expiry 15 min: a reply held for a hook transport that no session picked up is discarded and shown as expired, with one-click resend; both configurable | Derived | 2026-11-14 | Busy sessions take replies between tool calls so a short hard failure would be wrong; stale replies are T-06 |
| 23 | Overlap with the w-warp and herdr hooks is ignored (different purpose) | Decided | 2026-11-14 | User answer |
| 24 | The hooks design must be informed by the existing w-warp and herdr hooks (payload fields, state mapping, sub-agent detection, spawn cost, bugs fixed); study in progress, findings go to `research/` before the design is changed | Decided | 2026-11-14 | User expectation; my first pass only listed their events, nobody had read their scripts |

## Open Questions

| # | Question | Priority | Status |
|---|---|---|---|
| Q1 | Reply channel transports | High | Resolved (decision 7, PoC numbers in evidence.md) |
| Q2 | Live push to the UI | High | Resolved (derived, decision 8) |
| Q3 | Web UI structure | Medium | Resolved (derived, decision 9) |
| Q4 | Security of the reply channel (T-01) | High | Resolved provisionally (derived, decision 11) |
| Q5 | Hook installation | Medium | Resolved (derived, decision 13) |
| Q6 | State model and sub-agent tracking | Medium | Resolved provisionally (derived, decision 14) |
| Q7 | Main screen layout and variants | High | Resolved provisionally (derived, decision 15) |

## Modules / Sub-files

| File | Contents |
|---|---|
| `guiding-principles.md` | Core principles driving all decisions |
| `out-of-scope.md` | Explicitly excluded items |
| `threat-model.md` | Security threats and mitigations |
| `evidence.md` | Verified facts with their source |
| `decisions-pending.md` | Every question waiting on the user, self-contained |

## Changelog

| Version | Date | Summary |
|---|---|---|
| v0.1 | 2026-11-14 | Initial spec created; phasing fixed by the user |
| v0.2 | 2026-11-14 | Research persisted (`research/`), PoC measured, decisions 1-17, `architecture.md`, v1 plan (`.claude/plans/2026-11-14_agent-manager-v1.md`), threats T-01..T-07 |
