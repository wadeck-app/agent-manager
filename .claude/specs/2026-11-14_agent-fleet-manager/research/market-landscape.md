# Market landscape -- agent fleet management tools

Date: 2026-11-14. Gathered by a web-research sub-agent (about 25 primary pages fetched). 
Status: all `agent report`, not re-fetched by the lead. The agent could not verify Warp docs (every URL tried returned 404), nor Claude Squad, Crystal or Claudia internals.

## Conclusion

No tool documents all of: hook-based state, transcript browsing with collapsed tool calls, a live sub-agent tree, uniform structured questions and approvals, and good Windows support. Four capture approaches exist (below); a hybrid of hooks (state), transcripts (content) and a socket (reply) is plausible but nobody documents doing all three.

## Four state-capture approaches

| # | Approach | Examples | Pros | Cons |
|---|---|---|---|---|
| 1 | Hooks / structured events | Claude Code hooks, Cursor hooks, Herdr "add support" API | Precise, low latency; permission, subagent and idle events; hooks can answer permission prompts | One adapter per agent; hook schemas change |
| 2 | Transcript / on-disk tailing | opcode, CloudCLI (read `~/.claude`), ccusage | No wrapping; works on sessions you did not start; full history | Read-only alone; "waiting" is inferred and lags; undocumented formats |
| 3 | PTY / tmux wrapping, screen scraping | AgentAPI, Claude Squad, agent-deck, probably Herdr | Works with any CLI; native reply and attach | Fragile to TUI changes; no structure for tool calls or subagents |
| 4 | Own harness or protocol | Devin, OpenHands, Codex Cloud, Cursor Cloud, Zed via ACP | Full structured state, approvals, questions | Gives up the native CLI; ACP depends on agent support |

## Tools surveyed

### Local, terminal-based

| Tool | URL | What it does / how it gets state | Notes |
|---|---|---|---|
| Claude Squad | https://github.com/smtg-ai/claude-squad | TUI `cs`; tmux session + git worktree per agent; state from tmux; preview and diff tabs | Claude, Codex, Gemini, Aider, others via `-p`; `-y` auto-accept experimental; README mentions no notifications |
| agent-deck | https://github.com/asheshgoplani/agent-deck | Go + Bubble Tea on tmux, MIT; working/waiting/done per agent | Search, fork, groups, worktrees, Docker sandboxes, web UI, cost dashboard, "conductor/watchers" for phone monitoring; status detection undocumented; needs WSL on Windows |
| Herdr | https://github.com/ogulcancelik/herdr | Rust, Apache-2.0 multiplexer; panes labelled working/blocked/idle; notifies when an agent needs an answer | Detach/reattach; aggregates local and SSH machines; socket API so agents can spawn panes and wait on each other; detection mechanism not verified; PowerShell installer (Windows level unverified by the survey agent) |
| AgentAPI | https://github.com/coder/agentapi | Go wrapper exposing an agent over HTTP/SSE via an in-memory terminal emulator; diffs snapshots into messages | `/messages`, `/message`, `/status`, `/events`; ~11 agents; **archived/deprecated**; README warns TUI changes break cleanup |

### Desktop apps

| Tool | URL | What it does | Notes |
|---|---|---|---|
| Conductor | https://www.conductor.build | Mac only; isolated workspace per agent; Claude Code, Codex, Cursor; "what is each agent doing" dashboard; review-and-merge | State mechanism and pricing not verified |
| Superset (Paradev) | https://github.com/superset-sh/superset | MIT, free locally, Pro for mobile/automations; worktree per task; sidebar working/finished/waiting; chimes and dock badges | Many CLIs supported, any CLI works unconfigured; Changes/PR pane; iPhone app; remote hosts; no Windows build per survey; state mechanism not verified |
| Nimbalyst (repo has `crystal-run.*` scripts) | https://github.com/Nimbalyst/nimbalyst | MIT; session kanban; per-edit red/green diff accept/reject; iOS companion | Companion shows which agents need you vs working, text or voice reply, swipe-to-approve diffs, push when an agent waits; Codex and Claude Code, OpenCode and Copilot in alpha; "formerly Crystal" not confirmed |
| Sculptor (Imbue) | https://github.com/imbue-ai/sculptor | MIT research preview; isolated worktrees; Claude Code and Pi | Container backend experimental; state mechanism not verified |
| opcode | https://github.com/winfunc/opcode | Tauri, AGPL, ~22k stars; spawns `claude`, reads `~/.claude/projects/` | Session checkpoints and timeline with diffs, usage dashboard, MCP/CLAUDE.md management; Claude only; no release binaries at the time. Claudia: not fetched, believed to be its earlier name (unverified) |
| Vibe Kanban | https://github.com/BloopAI/vibe-kanban | Kanban board; workspace per issue with branch, terminal, dev server; Apache-2.0; 10+ agents | Inline diff comments sent straight to the agent; **README says the project is sunsetting** |
| Zed | https://zed.dev/docs/ai/external-agents | Hosts external agents over the Agent Client Protocol (ACP) | Import existing sessions; raw protocol log via `dev: open acp logs`; native tool permissions stay with the agent |
| Warp | not verified | -- | All docs URLs tried returned 404 |

### Remote and web UIs

| Tool | URL | What it does | Notes |
|---|---|---|---|
| Happy | https://github.com/slopus/happy | MIT; `happy claude` / `happy codex` wrap the CLIs | iOS/Android/web, E2E encrypted relay, APNs/FCM push, multiplayer steering; permission flow and push triggers undocumented on README |
| CloudCLI / claude-code-ui | https://github.com/siteboon/claudecodeui | AGPL; web and mobile UI; discovers sessions from `~/.claude` | Shell terminal, file/git explorer, plugins; Claude Code, Cursor CLI, Codex, OpenCode; hosted option from EUR 7/month; chat mechanism not verified |
| Claude Code Remote Control | https://code.claude.com/docs/en/remote-control | Local session driven from claude.ai/code or the Claude mobile app | Subagent and workflow progress stay in sync across devices |

### Cloud agents

| Tool | URL | Notes |
|---|---|---|
| Cursor Cloud Agents | https://cursor.com/docs/cloud-agent | Formerly Background Agents; isolated VMs; launch from web/iOS/Slack/Linear/API; screenshots, videos, logs; remote-desktop take-over; teammates view by URL (read-only unless follow-ups enabled); not on Free/Plus |
| Codex Cloud | https://learn.chatgpt.com/docs/cloud | Per-task sandboxes that run while your computer sleeps; review files, follow-ups, commit or PR; status/notification/approval details not on the page |
| Devin | https://docs.devin.ai/get-started/devin-intro | Own harness with shell, IDE, browser you can take over; Slack/Teams; status/question/pricing not covered |
| OpenHands | https://github.com/OpenHands/OpenHands | MIT; "Agent Canvas" frontend over its agent server plus Claude Code, Codex, Gemini CLI, anything speaking ACP; cloud/enterprise tier; automations from Slack/GitHub/Linear; approval mode not on page |

### Other

| Tool | URL | Notes |
|---|---|---|
| ccusage | https://github.com/ryoppippi/ccusage | Reads locally stored usage; cost per day/month/session; `blocks` for 5-hour windows; beta `statusline`; not a live fleet dashboard |
| Ruflo (formerly claude-flow) | https://github.com/ruvnet/ruflo | MCP and hook-based meta-harness with swarm orchestration; benchmarks self-reported, demos use sample data; an orchestrator, not a monitor |

## UX ideas worth stealing

- Three-state badge (working, blocked, idle) per agent in a persistent sidebar (Superset, Herdr, agent-deck).
- Mobile "needs me" queue with text or voice reply and swipe-to-approve diffs (Nimbalyst).
- Inline diff comments sent directly to the agent (Vibe Kanban).
- Checkpoint timeline and fork (opcode).
- Detach/reattach with resume after restart; combined local + SSH agent list (Herdr).
- Read-only-by-default "connect an assistant to my sessions" (agent-deck).
- Raw protocol log toggle (Zed's ACP log).
- Artifact-as-proof: screenshots, video, logs attached to a finished run (Cursor Cloud).
- Take-over handoff between agent and human (Devin, Cursor).

## Gaps nothing fills well (survey agent's claims)

| Gap | Note |
|---|---|
| Live sub-agent tree | Remote Control mentions subagent progress syncing; no third-party tool documents a hierarchy |
| Uniform structured questions/approvals across Claude, Codex, Gemini, OpenCode | Nimbalyst, Happy, Remote Control reach a phone but no common schema documented |
| Collapsed tool-call browsing | Not documented as a feature anywhere; "claimed gap, not a proven one" |
| Cross-agent transcript normalisation into one searchable log | ccusage normalises usage only |
| Maintenance risk | AgentAPI deprecated, Vibe Kanban sunsetting, opcode no binaries, Sculptor preview |
| Windows | Conductor Mac only, Superset no Windows build, agent-deck needs WSL; Herdr has a PowerShell installer (quality unverified) |

## Hook facts the survey agent collected (see also `claude-code-hooks-and-transcripts.md`)

Source: https://code.claude.com/docs/en/hooks (agent read the first 100k of 293k chars). `Notification` matchers: `permission_prompt`, `idle_prompt`, `elicitation_dialog`, `agent_needs_input`, `agent_completed`. `PermissionRequest` hooks can return allow/deny; exit code 2 not honoured there. `SubagentStart`/`SubagentStop` exist; every payload has `session_id` and `transcript_path`, subagent hooks add `agent_id` and `agent_type`. `StopFailure` reports API errors. `Elicitation` covers MCP questions. Whether `AskUserQuestion` appears as a tool name: not confirmed.
