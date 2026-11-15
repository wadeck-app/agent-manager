# Spec: Agent Fleet Manager

**Created:** 2026-11-14
**Version:** v0.3
**Status:** In Review -- v0.3 -- 7/7 questions resolved (4 provisional); design review 1 applied (decisions 29-41); D-B pending the user; awaiting user review
**Iteration:** 1

## Summary

A CLI (`agent-manager`, decision 18) wired into Claude Code global hooks, feeding a web UI (app-core app-module) that shows the state of all agents, lets the user browse logs with collapsed tool calls, reply to agents, and follow sub-agents. Later: w-guardrails bypass management (v2), structured-question MCP server (v3), OpenCode/Codex adapters (v4). Patterns follow the sibling CLIs `queue`, `task`, `project`.

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
| 14 | State model derived from hook events: starting, working, waiting-permission, waiting-user, idle, error (StopFailure), ended; sub-agents from SubagentStart/Stop plus `subagents/agent-<id>.jsonl` and `meta.json` | Derived | 2026-11-14 | Event list in research; exact mapping still to be checked on real payloads -- refined by w-warp/herdr study, see research/w-warp-herdr-hooks.md |

| 15 | Main screen: one page, three layout variants wired into the real page behind the A/B dock: A "needs me" inbox, B fleet board, C session rail + focus pane. Default C, with a "needs me" badge and counter in the rail from day one | Derived | 2026-11-14 | User asked for heavy A/B use and lists state overview, log browsing, replies in that order; choice is reversible through the dock, so no question needed |
| 16 | Observation hooks (all events except the reply hook) run `async: true` so they can never block an agent; only the reply hooks (blocking Stop hot-wait, asyncRewake) are non-plain | Derived | 2026-11-14 | Hooks are synchronous by default (T-02); hook docs (agent report): plain async has no enforced timeout and cannot influence the session. Spawn cost of the hook CLI per event is NOT measured yet |
| 17 | v1 shows transcript content unmasked (local, single user); no secret masking | Derived | 2026-11-14 | User fact: app-core is local only; masking would hide the data the user came to read; revisit with remote access |

| 18 | CLI and package name: `agent-manager` | Decided | 2026-11-14 | User answer |
| 19 | The reply transport is configurable and switchable in one click or key (global default, per-session override, CLI `transports`), each with live measured latency; the default is proposed, not imposed | Decided | 2026-11-14 | User request: switch quickly to see the differences |
| 20 | Repo: `origin` = https://github.com/wadeck-app/agent-manager (exists, empty); the CI publish pipeline is pre-approved by the user | Decided | 2026-11-14 | [V] `git remote -v`, `git ls-remote origin` empty; user: CI approved when the repo and requirements were given |
| 21 | Retention: 90 days and 200 MB per data category (event history, logs, uploads), like queue's history | Derived | 2026-11-14 | User gave 90 d / 200 MB for logs; I extend it to uploads (pasted images saved to disk) |
| 22 | Confirmation window 15 s: after it a reply shows "unconfirmed" (not failed) and keeps being watched; mailbox expiry 15 min: a reply held for a hook transport that no session picked up is discarded and shown as expired, with one-click resend; both configurable | Superseded by Decision #26 (window); mailbox part kept in #27 | 2026-11-14 | Busy sessions take replies between tool calls so a short hard failure would be wrong; stale replies are T-06 |
| 23 | Overlap with the w-warp and herdr hooks is ignored (different purpose) | Decided | 2026-11-14 | User answer |
| 25 | Hooks follow the w-warp/herdr lessons: fail-open, sub-agent events tagged by agent_id and excluded from main-session state, no sleeps in hooks | Derived | 2026-11-14 | `research/w-warp-herdr-hooks.md` (agent report; real log counts: 256k sub-agent PostToolUse) |
| 24 | The hooks design must be informed by the existing w-warp and herdr hooks (payload fields, state mapping, sub-agent detection, spawn cost, bugs fixed); study in progress, findings go to `research/` before the design is changed | Decided | 2026-11-14 | User expectation; my first pass only listed their events, nobody had read their scripts |

| 26 | Confirmation window is configurable, default 0 = no timeout (a reply stays "sent, unconfirmed" until it is seen in the transcript or the user dismisses it); durations are accepted as `30s`, `15m`, `5h`, `1d`, `1h5m30s`. Supersedes the 15 s of decision 22 | Decided | 2026-11-14 | User answer |
| 27 | Mailbox expiry keeps 15 min as default, same duration syntax, configurable (hook transports only) | Derived | 2026-11-14 | User: "do as you see fit" |
| 28 | The CI/publish pipeline is part of v1 M1, not later: `npm install -g @wadeck-app/agent-manager-cli` must work like the other CLIs (family A, GitHub Packages) | Decided | 2026-11-14 | User: CI was requested in the spec's business requirements |

| 29 | Hooks scope: register only low-volume events (SessionStart, SessionEnd, UserPromptSubmit, Stop, StopFailure, Notification, PermissionRequest, PermissionDenied, SubagentStart, SubagentStop); no PreToolUse; PostToolUse not registered by default (the transcript tailer provides tool activity; opt-in per session when not tailed); hooks call `node <absolute>/hook.cjs` directly, not the npm shim, absolute paths only (no `%USERPROFILE%`); the tailer skips `attachment` and `api-request-blob` lines by prefix without `JSON.parse`; M0 reads existing `hook_success.durationMs` for free. Refines decisions 2, 13, 16 | Derived | 2026-11-14 | R-01, R-08, R-14 (`research/design-review-1.md`) |
| 30 | The registry (`fs.watch` on `~/.claude/sessions`) is the primary source for busy/idle, liveness and name; hooks only for waiting-permission, sub-agents and errors; `procStart` is a Windows FILETIME (reviewer-verified, about 6 s from `startedAt`); M0 tests whether registry `status` changes during a permission dialog, and how to read process start time or use a named-pipe connect probe | Derived | 2026-11-14 | R-02 |
| 31 | Agent-to-agent injection hardening (new threat T-08): mutating routes require `Sec-Fetch-Site: same-origin` plus a per-page-load CSRF header; per-target rate limit; the origin marker states origin, not trust; residual risk documented honestly (a same-user process can still fetch the page); a w-guardrails rule denying curl to `127.0.0.1:4850/api/modules/agent-manager` is a cross-repo request pending the user (D-B in `decisions-pending.md`) | Derived | 2026-11-14 | R-03, R-07 |
| 32 | Uploads: base64 inside JSON, at most 700 KB per request (app-core body limit 1 MiB, JSON only, no multipart), client-side canvas downscale or re-encode; no app-core change | Derived | 2026-11-14 | R-04 |
| 33 | Delivery with window 0: a soft hint "probably not delivered, fix: ..." after 15 s when the session is idle and the transcript did not grow (configurable `hintAfter`), and an intermediate "queued in session" state from `queue-operation` lines; hook-transport confirmation differs (a reminder is not a user line; how it appears is UNVERIFIED) | Derived | 2026-11-14 | R-05 |
| 34 | Daemon-to-module path: the module backend opens an SSE client to the daemon and fans out to browsers; one SSE per browser through a leader tab (Web Locks) relaying with `BroadcastChannel`; no `<audio>` and no workers (CSP); test module reload mid-stream | Derived | 2026-11-14 | R-11, R-09 |
| 35 | Notifications: tab title and favicon badge (favicon from a module route), optional daemon OS toast, emit `agent.session.waiting` through queue-sdk best-effort, rule "only when not focused" | Derived | 2026-11-14 | R-10, R-19 |
| 36 | Session state carries a bounded `permission_summary` (tool, command or file preview, at most 200 chars) | Derived | 2026-11-14 | R-12 |
| 37 | Socket frames send `msg_id`, `session_id` and a user-selectable priority (now/next/later); M0 tests `msg_id` dedupe | Derived | 2026-11-14 | R-13 |
| 38 | UX additions planned: search over transcripts, cost and context from `message.usage`, Edit diffs/TodoWrite/thinking rendering, registry name and `permissionMode`, stuck badge, per-session composer drafts in localStorage, jump-to-terminal via herdr when available; sub-agent model adds `fork-context-ref`, `isFork`, `background`, `spawnDepth`, `model`; approve/deny of permission prompts from the UI parked as a v1.5 question | Derived | 2026-11-14 | R-16, R-17 |
| 39 | Daemon start purges history/logs/uploads (90 days, 200 MB); `doctor --fix`; hook argv carries the plugin version; plugin release path decided at M2 | Derived | 2026-11-14 | R-15 |
| 40 | Default daemon port 47930 (siblings use 47823, 47900, 47910-11, 47920-21), override `AGENT_MANAGER_DAEMON_PORT`; exit codes defined per command in a table like queue | Derived | 2026-11-14 | R-19 |
| 41 | A Claude Code mod (`turn.start`, `tool.call`, `session.send` API) is evaluated at M0 as an alternative state source behind an interface; moving API risk noted | Derived | 2026-11-14 | R-18 |

| 42 | The daemon dedupes replies itself (socket `msg_id` does not dedupe: 2 turns observed) and never auto-resends | Derived | 2026-11-14 | `research/m0-measurements.md` D1 [V] |
| 43 | Reply priority defaults to `next`; `now` aborts the running tool call (observed, n=1) so the UI requires an explicit confirmation for it; `later` runs as an extra turn | Derived | 2026-11-14 | `research/m0-measurements.md` D2 (agent report, suggestive) |
| 44 | State model refined from herdr: groups Pinned (overlay; pinned rows leave their state group but keep their state icon), Needs you (registry status waiting, red), Done (idle after a finished turn and not yet seen, blue), Working (busy or shell, amber), Idle (seen, neutral); any unmapped status is shown visibly as Other, never hidden; time in state = now - statusUpdatedAt in compact form. Supersedes the state list of decision 14 where they differ | Derived | 2026-11-15 | `research/ui-inspiration.md` sections 1 and 4 (herdr docs V; pinned-row derivation V by the lead from the screenshot counts 2+1+1+4+7 = 15) |
| 45 | `seenAt` and pins are stored server-side in the module data dir, global (not per browser) because the user is single; a session is marked seen by opening it, replying, or the explicit action; reversible by switching to per-browser | Derived | 2026-11-15 | herdr keeps seen per client (V); a single user on one machine needs no per-client copy |
| 46 | Sort within groups: Needs you and Done oldest first (longest waiting on top), Working and Idle most recent first, Pinned in pin order; the UI explains it | Derived | 2026-11-15 | herdr's sort is undocumented; this one puts the longest wait on top |
| 47 | Variants roadmap for the A/B `sessions-layout`: table, cards, herdr (built first), then board (F), triage inbox (B), split tabs (C), project tree (D), status tiles (E), dense table (G), master-detail with log and reply pane (H, default direction together with A), command palette (I), tagged batch (J, needs a confirmation per row because of the mass-approval risk); first comparisons A vs D, A vs B, A vs G | Derived | 2026-11-15 | `research/ui-inspiration.md` section 5 and 6; user asked for several variants inspired by herdr and other apps |
| 48 | Keyboard model planned: `b/w/i/d` filter by group (herdr), `/` search, `j/k` move, `Cmd+K` palette, snooze, digit decision keys on Needs you rows (Linear triage idea) | Derived | 2026-11-15 | herdr keyboard docs (V), Linear Inbox and Triage (V) |
| 49 | Notifications reuse the state model: separate request (needs you) and done sounds and toasts, no toast for the focused tab, tab-title counter of needs-you plus done; extends decision 35 | Derived | 2026-11-15 | herdr configuration docs (V), Warp notifications (V) |
| 50 | Second reply transport `hc`: `hc send` types the reply into the herdr-core terminal as the user (no wrapper, queued while the agent works). Selectable per session or as default; the default stays `socket`. Never `--force`; refused while the terminal is blocked on a dialog | Derived (provisional) | 2026-11-15 | research/hc-transport.md |
| 51 | Session to terminal mapping: registry pid equals `foreground.pid` of exactly one `hc get`; none or several means unavailable with the reason, never a guess. A claude started through a wrapper process is not found | Derived (provisional) | 2026-11-15 | research/hc-transport.md |
| 52 | Socket `msg_id` is a UUID (the message id when it is one, else a UUID derived from it) so `origin.msg_id` confirms delivery; the text marker stays the fallback and for `hc` | Derived (provisional) | 2026-11-15 | research/hc-transport.md |
| 53 | Transport selection lives in `transports.json` only (module PUT routes, `agent-manager transport list|set|unset`); a reply carries no transport field; no fallback to another transport when the selected one fails | Derived (provisional) | 2026-11-15 | research/hc-transport.md |

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
| Q8 | w-guardrails rule denying curl to the reply route (cross-repo, D-B) | Medium | Open (pending the user) |
| Q9 | `seenAt` global vs per browser and pin ordering: derived (decisions 45, 46), user may overturn | Low | Resolved provisionally (derived) |

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
| v0.3 | 2026-11-14 | Design review 1 persisted (`research/design-review-1.md`); decisions 18-41; threats T-08..T-11; stale text synced (status, plan, architecture header, threat model) |
| v0.2 | 2026-11-14 | Research persisted (`research/`), PoC measured, decisions 1-17, `architecture.md`, v1 plan (`.claude/plans/2026-11-14_agent-manager-v1.md`), threats T-01..T-07 |
