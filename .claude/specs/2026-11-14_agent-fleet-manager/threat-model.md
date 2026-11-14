# Threat Model -- Agent Fleet Manager

**Version:** 1.0
**Date:** 2026-11-14
**Methodology:** STRIDE

## Scope

Hook-fed CLI, local daemon, web UI, and the reply channel that injects user text into running agents.

## Assets

| Asset | Sensitivity | Owner |
|---|---|---|
| Agent transcripts (code, secrets in tool output) | High | User |
| Reply channel (text injected into agents that run with the user's rights) | High | User |
| Permission bypasses (v2) | High | User |

## Threat actors

| Actor | Motivation | Capability |
|---|---|---|
| Other local process/user | Read logs, inject replies | Reach localhost ports |
| Malicious web page | CSRF / DNS rebinding to localhost daemon | Browser requests to localhost |

## STRIDE analysis

### Spoofing
Unauthenticated localhost UI/daemon could be driven by any local process or web page. *(decision pending)*

### Tampering
Reply injection and (v2) bypass grants change what agents do. *(decision pending)*

### Repudiation
*(pending)*

### Information Disclosure
Transcripts may contain secrets; the UI exposes them. *(decision pending)*

### Denial of Service
Hooks run synchronously in Claude Code: a slow or hung CLI blocks the agent. *(decision pending)*

### Elevation of Privilege
Reply channel and v2 bypass UI are privilege-bearing. *(decision pending)*

## Mitigations

| ID | Threat category | Threat description | Mitigation | Status | Decision # |
|---|---|---|---|---|---|
| T-01 | Spoofing/EoP | Local web page or process drives the UI/daemon (reply = keyboard-equivalent user message via the socket) | app-core loopback guard (cross-site non-GET and non-loopback Host refused, agent report); same-user processes can already use `claude-inbox.js`, so no new local capability; audit log + origin marker (decision 11) | Mitigated (provisional) | 11 |
| T-02 | DoS | Hook latency or failure blocks agents | Hooks forward with a short timeout, never block, log failures (decision 2); blocking Stop hot-wait is opt-in and bounded by its timeout | Partly mitigated; hook timeout value still to set | 2 |
| T-03 | Info disclosure | Transcripts contain secrets; the UI displays them | Read in place, never copied (decision 10); app-core loopback only (user fact); secret masking in the viewer still to decide | Open | 10 |
| T-05 | Tampering/EoP | Image upload abuse: path traversal, wrong file type, huge file | Fixed uploads directory, no user-controlled path segments, magic-byte check, size cap (values to set, see architecture.md) | Open | 5 |
| T-06 | Spoofing | Stale or replayed reply delivered to the wrong or a later turn | Message id, expiry, consume once; delivery state from the transcript | Open | 7 |
| T-07 | Tampering | Reply text acts as prompt injection into an agent | Origin marker (decision 11); hook transports frame it as a system reminder | Open | 11 |
| T-04 | Tampering | Socket protocol is private; a Claude Code update can drop or hold messages silently | Delivery confirmed from the transcript, UI shows sent/confirmed/undelivered; contract test after each Claude Code update | Open (design pending) | 7 |

## Open security questions

*(none yet)*
