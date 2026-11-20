# Threat Model -- Agent Fleet Manager

**Version:** 1.1
**Date:** 2026-11-14
**Methodology:** STRIDE

## Scope

Hook-fed CLI, local daemon, web UI, and the reply channel that injects user text into running agents. app-core runs locally only (user fact, decision 11).

## Assets

| Asset | Sensitivity | Owner |
|---|---|---|
| Agent transcripts (code, secrets in tool output) | High | User |
| Reply channel (text injected into agents that run with the user's rights) | High | User |
| Session `.key` peer tokens read by the daemon | High | User |
| Uploaded images and audit log (kept 90 days, unmasked) | Medium | User |
| Permission bypasses (v2) | High | User |
| Owned sessions (daemon children that run tools with the user's rights) | High | User |

## Threat actors

| Actor | Motivation | Capability |
|---|---|---|
| Other local process/user | Read logs, inject replies | Reach localhost ports |
| An agent (any session) | Prompt-injected or misbehaving; reach another session | Bash tool: `curl` to the loopback reply route (R-03) |
| Malicious web page | CSRF / DNS rebinding to localhost daemon | Browser requests to localhost |
| Attacker-influenced transcript content | XSS or crafted links in the viewer | Text rendered by the UI (R-07) |

## STRIDE analysis

### Spoofing
Unauthenticated localhost UI/daemon could be driven by any local process, any agent via curl, or a web page. Mitigations: T-01, T-06, T-08.

### Tampering
Reply injection (T-07, T-08), uploads (T-05), the private socket protocol (T-04) and (v2) bypass grants change what agents do.

### Repudiation
Every web reply is recorded in the audit log (session, time, text, transport, outcome) shown in the UI (decision 11); the origin marker names the origin in the transcript. Audit files are append-only by convention, not tamper-proof against a same-user process (accepted, local single-user).

### Information Disclosure
Transcripts may contain secrets; the UI exposes them (T-03). Audit text and uploads persist 90 days unmasked (T-11).

### Denial of Service
Hooks run in the agent's process path: a slow or hung hook CLI would block the agent, and hook volume is high (T-02).

### Elevation of Privilege
Reply channel and v2 bypass UI are privilege-bearing (T-01, T-08, T-10).

## Mitigations

| ID | Threat category | Threat description | Mitigation | Status | Decision # |
|---|---|---|---|---|---|
| T-01 | Spoofing/EoP | Local web page or process drives the UI/daemon (reply = keyboard-equivalent user message via the socket) | app-core loopback guard (cross-site non-GET and non-loopback Host refused; requests with no `Sec-Fetch-Site`/`Origin` pass, `requestGuard.ts:51-69`, reviewer-verified); implemented 2026-11-15 in the module (`backend/csrf.ts`, enforced in the route kit for every non-GET route): `Sec-Fetch-Site: same-origin` AND header `X-Agent-Manager-Csrf` with the token of `GET /csrf` (HMAC, new secret per module start), else 403 (decision 31; tests `csrfRoutes.test.ts`); audit log + origin marker (decision 11) | Mitigated (provisional); curl case split out as T-08 | 11, 31 |
| T-02 | DoS | Hook latency, failure or volume blocks or slows agents | Observers fail open, exit 0, no sleeps, absolute-path `node hook.cjs`, low-volume event set, no PreToolUse, PostToolUse opt-in (decisions 2, 16, 25, 29); blocking Stop hot-wait is opt-in and bounded by its timeout; spawn cost measured at M0 (reviewer: PostToolUse median 145 ms in w-warp logs) | Partly mitigated; hook timeout value and spawn cost open (M0) | 2, 29 |
| T-03 | Info disclosure | Transcripts contain secrets; the UI displays them | Read in place, never copied (decision 10); app-core loopback only (user fact); v1 shows content unmasked by decision (decision 17) | Accepted (decision 17), revisit with remote access | 10, 17 |
| T-04 | Tampering | Socket protocol is private; a Claude Code update can drop or hold messages silently | Delivery confirmed from the transcript, UI shows sent/confirmed/undelivered plus a soft "probably not delivered" hint when the window is 0 (decision 33); contract test after each Claude Code update; `doctor` version warning | Open (design applied, M4 implements) | 7, 33 |
| T-05 | Tampering/EoP | Image upload abuse: path traversal, wrong file type, huge file | Fixed uploads directory, no user-controlled path segments, magic-byte check, base64-in-JSON at most 700 KB per request (decision 32), purge at 90 days / 200 MB | Open (M4 implements) | 5, 32 |
| T-06 | Spoofing | Stale or replayed reply delivered to the wrong or a later turn | Message id (`msg_id`), expiry (mailbox 15 min), consume once; delivery state from the transcript; M0 tests socket `msg_id` dedupe (decision 37) | Open | 7, 27, 37 |
| T-07 | Tampering | Reply text acts as prompt injection into an agent | Origin marker (decision 11); hook transports frame it as a system reminder; `socket` stays the default; `hc` is chosen explicitly per session or default and the UI/CLI say "typed prompt (as the user)" | Open. The `hc` transport (decisions 50-53) removes the peer wrapper: its replies are indistinguishable from the user's typing, so a reply or an injected one has full user authority, also in bypass sessions | 11 |
| T-08 | Spoofing/EoP | Agent-to-agent injection: any agent's Bash tool can `curl` the unauthenticated loopback reply route and type into another session (possibly one in bypass mode); the origin marker can make it look like a trusted web reply (R-03) | Implemented: every non-GET route requires `Sec-Fetch-Site: same-origin` plus the `X-Agent-Manager-Csrf` token (403 otherwise: curl, node fetch and agents send no `Sec-Fetch-Site`); per-session rate limit in the reply service, any transport (6 per 60 s); the marker states origin, not trust (decision 31); w-guardrails deny rule for curl to `127.0.0.1:4850/api/modules/agent-manager` pending the user (D-B). `hc` transport mitigations implemented: refused while the terminal is blocked (checked right before, `hc` repeats it), never `--force` (it would answer the dialog), per-session rate limit (6 per 60 s), HC_TERMINAL_ID removed from the child (no `<hc from>` tag), audit records the transport id, one terminal or unavailable. Residual: a same-user process can already run `hc send` itself; a same-user process can still fetch the page and read the CSRF value | Partly mitigated: web pages and naive scripts refused; a header-forging same-user agent is not (D-B pending) | 31 |
| T-09 | Tampering/EoP | UI-side injection: the viewer renders attacker-influenced transcript content and a `dslLib` component has full DOM access; XSS or a crafted link could post replies | Escape everything, no raw HTML, reuse the safe markdown, safe link targets and ANSI stripping from agent-fleet (`research/agent-fleet-reuse.md`), CSP stays strict, images only from a module route; CSRF header (T-08) also blocks forged posts | Open (M3 implements) | 31 |
| T-10 | EoP/Info disclosure | Credential concentration: the daemon reads every session's `.key` peerToken and becomes a keyboard for all sessions | Read tokens only at send time, never log or persist them, daemon bearer token required for its API; verify the token-file ACL on Windows at M1 (`chmod 0600` is not enforced there, UNVERIFIED) | Open (M1 checks the ACL) | 31 |
| T-11 | Info disclosure | Secrets persist: audit text and uploads kept 90 days unmasked | Documented in the UI and README; purge at daemon start and a purge command (decision 39); revisit masking with remote access (decision 17) | Accepted (documented) | 21, 39 |
| T-12 | Spoofing/EoP | A local process (or an agent through Bash) that holds the daemon token launches claude sessions, sends them messages, switches their permission mode or approves their tool calls: a keyboard plus an approval button | Daemon bearer token on every route (`health_token`, constant-time compare, never in a response, log, event or audit); sessions API on 127.0.0.1 only, Host must be loopback with the API port (DNS rebinding), ANY request with an `Origin` header refused (only server-side callers use the API: the app-core module backend and the CLI send none; "not for browsers"), `Sec-Fetch-Site: cross-site` refused, token never accepted in the URL; strict body validation (1 MiB, JSON only, unknown fields refused, absolute existing cwd, model and mode checked so a value cannot become a flag, images by magic bytes, 700 KiB); at most 10 live children; the SSE stream carries ids, states, counts, tool name, display name, the permission description (cut to 300 characters) and the blocked path, never message text, tool input, stderr, protocol error details or a token (full tool input only on `GET /sessions/:id/permissions`, stderr tail only on `GET /sessions/:id`); the audit (`audit/owned-<day>.ndjson`) records launch, resume, send (counts only), interrupt, mode, permission decision (tool name only), stop, forget, shutdown, never text, tool input or token; allow is once (suggestions never echoed); children are ended only by the daemon that started them, leftovers after a crash are listed, never killed | Implemented (Phase 2). Residual: the singleton-daemon-kit control server (port 47930) has no Host/Origin check and no body cap, but serves only `status`, `shutdown`, `/quit`, `/health` and `/version` (no token needed for `/version`: pid, ports); `health_token` ACL on Windows still unverified (T-10); any same-user process can read the token file | 1, 34, 40 |

## Open security questions

- D-B: should w-guardrails deny `curl`/`wget` to the reply route (cross-repo request)? See `decisions-pending.md`.
- Windows ACL of `health_token` and of the session `.key` files (M1).
- Whether w-guardrails already blocks curl to loopback (UNVERIFIED).
