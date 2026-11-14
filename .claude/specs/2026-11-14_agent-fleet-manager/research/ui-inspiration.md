# UI inspiration for the Agents page (herdr reference, 14+ interfaces, 10 variant concepts)

Date: 2026-11-15. Gathered by a research agent (web fetch, read-only). Reference image `assets/herdr-agents-panel.png` was read by the lead.
Marks: V = read on the cited page; P = page only partly covers it; U = not verified (memory or image only). Nothing here is upgraded beyond the agent's mark.

## 1. herdr

Image [V by the lead, read directly]:
- Header "Agents" with a history icon. Colour group headers with counts: Pinned 2 (neutral), Needs you 1 (red), Done 1 (blue), Working 4 (amber), Idle 7 (grey).
- Row: harness icon, project in bold, session name muted, time in state right-aligned (`<1m`, `3m`, `44m`, `7h`), status icon: amber ring (working), red "!" (needs you), blue dot (done), hollow circle (idle). The top row has a selection highlight.
- Lead derivation [V by the lead]: the counts 2+1+1+4+7 = 15 equal the number of rows shown; the two Pinned rows (`_test-factory`, `machine`) show a working icon and are NOT repeated in the Working group (4 other rows), so a pinned row leaves its state group and keeps its state icon.

Docs:

| Topic | Finding | Mark |
|---|---|---|
| States | `blocked` needs "input, approval, or a decision"; `working` "actively running"; `done` finished and "you have not looked at it yet"; `idle` finished or waiting and already seen; `unknown` cannot classify (https://herdr.dev/tui/docs/concepts/) | V |
| Seen | tracked per client: viewing a completion in one client does not clear Done in another | V |
| Done | not a detection state but a rollup: stays visible until viewed; `blocked` wins rollups over `working` (https://herdr.dev/tui/docs/agents/) | V |
| Detection | screen manifests, or hook reports from `herdr integration install claude` (reports replace screen reading); blocked detection "deliberately strict"; unknown screens fall back to idle, idle is not authorization | V |
| Notifications | `[ui.toast] delivery` = herdr, terminal, system or off; popups for the active tab suppressed; sound files `done_path` and `request_path`, per agent; `status_indicators = "symbols"` adds shape to colour (https://herdr.dev/tui/docs/configuration/) | V |
| Navigation | Goto picker `prefix+g` grouped by workspace; `/` searches names, kinds, tabs, workspaces, branches, paths; `b/w/i/d` filter blocked/working/idle/done, `a` clears; no "jump to next blocked" key; `keys.next_agent`, `keys.previous_agent`, `keys.focus_agent` (1-9) unset by default; `open_notification_target` is `prefix+o` (https://herdr.dev/docs/keyboard/) | V |
| Ordering | `ui.agent_panel_sort` = `spaces` (default) or `priority`; semantics of `priority` not explained | V |
| Row layout | configurable tokens (`state_icon`, `state_text`, `agent`, `$custom`), `rows_by_agent` overrides | V |
| Not documented | pinning mechanics, sort within group, time-in-state rules, exact group names | V that docs are silent; anything else U |

## 2. Survey

### Agent tools

| Tool | Layout and state encoding | Steal | Mark |
|---|---|---|---|
| Warp (https://docs.warp.dev/agent-platform/warp-agents/agent-notifications) | per-tab icon (working, blocked, completed, errored) + unread badge, visiting marks read; bell mailbox with All/Unread/Errors, "Mark all as read", arrows/Enter; toasts (max 2) jump to the session; Complete/Request/Error; orchestrated children kept out of the mailbox, pill bar shows INPROGRESS, SUCCEEDED, BLOCKED, FAILED, ERROR, CANCELLED | parent only in the inbox, children in a separate strip | V |
| Claude Squad (https://github.com/smtg-ai/claude-squad) | TUI list left, Tab-switched preview/diff pane, bottom command menu; `j/k`, `Enter` attach, `n/N`, `D`, `c` pause, `r` resume; status visuals not in README | live preview of the selected row, one-key attach | P (status visuals U) |
| agent-deck (https://github.com/asheshgoplani/agent-deck) | dashboard "working, waiting, or done"; groups, fork, search `/`, `Enter` attach; colours, icons, waiting-jump key not in README | - | P (U) |
| Vibe Kanban (https://github.com/BloopAI/vibe-kanban) | kanban issues, workspace per card; status visuals not described | - | P |
| Nimbalyst (https://nimbalyst.com) | session kanban by phase (backlog, planning, implementing, complete); active, waiting and completed on the board; no dedicated attention queue described | phases as columns, waiting as a flag | P |
| Conductor (https://www.conductor.build/docs/) | one workspace per task with diff and checks; sidebar and status visuals not described | - | P |
| Cursor cloud/background agents (https://cursor.com/docs/background-agent) | cursor.com/agents, desktop app, iOS; run URLs shareable, read-only by default; list layout and statuses not described | - | P |
| Codex cloud (https://learn.chatgpt.com/docs/cloud) | task list layout and statuses not described; CLI lists recent cloud chats with status | - | P |
| Devin (https://docs.devin.ai/get-started/devin-intro) | session list not described; Shell, IDE, Browser tools you can step into | - | P |
| OpenHands (https://docs.openhands.dev/usage/cloud/cloud-ui) | only "Recent Conversations" mentioned | - | P |
| Copilot cloud agent (https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent) | repo "Agents" tab, session logs showing work and tools used, resumable across clients; layout, statuses, notifications not described | - | P |
| Zed threads (https://zed.dev/docs/ai/agent-panel) | Threads Sidebar grouped by project, `ctrl-tab` switcher, archive `shift-backspace`; notify/sound when waiting or done; queued-message strip (edit, steer, send now); collapsed tool calls not described | recent-thread switcher, archive-to-clear | V |

### Inbox and triage

| Tool | Layout and state encoding | Steal | Mark |
|---|---|---|---|
| Linear Inbox (https://linear.app/docs/inbox) | Priority tab, "Show unread first", `J/K`, `U` toggle read, `H` snooze, `Backspace` delete, `Cmd+F` search; no archive | snooze: "I will answer later" hides a row until a time or new activity | V |
| Linear Triage (https://linear.app/docs/triage) | separate queue; `1` accept, `2` decline, `3` duplicate, `H` snooze | single-digit decision keys on a needs-you item (approve, deny, reply) | V |
| GitHub Notifications (https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications) | group by repo or date, `is:done` and `is:saved`, "reason" label, bulk actions, preview in place | show the reason a row needs you (waitingFor); Done leaves the inbox | V |
| Slack sections (https://slack.com/help/articles/360043207674) | custom sections each with own sort (A-Z, Recency, Priority), default "Active only" hides items idle 30 days; unread bolding not on that page | per-section sort, auto-hide stale idle rows | P (bolding U) |
| Superhuman split inbox | tabs with counts, Tab to switch, `Cmd+K`, Done to reach zero; the page returned 403 | - | U |

### Lists, trees and boards

| Tool | Layout and state encoding | Steal | Mark |
|---|---|---|---|
| k9s (https://k9scli.io/topics/commands/) | `:` switch view, `/` regex filter, `!` inverts, `?` help, verbs `d` describe `l` logs | filter language with `!` meaning "not idle" | V |
| tmux choose-tree (https://man7.org/linux/man-pages/man1/tmux.1.html) | tree `+/-`, preview `v`, filter `f`, tag `t` then act on all tagged, sort `O` (index, name, activity), `x` kill, shortcut key per row | tag several rows and send one reply; per-row hotkeys | V |
| VS Code Source Control (https://code.visualstudio.com/docs/sourcecontrol/overview) | Staged and Changes groups; tree/list toggle not on that page | - | P (U) |
| Kubernetes Dashboard (https://kubernetes.io/docs/tasks/access-application-cluster/web-ui-dashboard/) | workload status charts not described; project deprecated | - | P |
| Buildkite | fetch returned empty; pipeline cards with build status from memory | - | U |
| htop, Activity Monitor, Trello/Jira, Datadog/Grafana tiles, GitHub Actions run list, wall board, Raycast / Cmd+K | not fetched; used only as generic patterns: sortable columns, status-count tiles, command palette | - | U |

## 3. Gaps

No page for Superset/Paradev (redirected to docs.paradev.com, not fetched), Conductor's sidebar, Devin's list, Cursor's and Codex's list UIs: not verified.

## 4. State model implied by herdr

| Group | Derivation from our data | Needs a marker |
|---|---|---|
| Needs you | registry status `waiting` (+ `waitingFor`); red; time = `now - statusUpdatedAt` | no (clears when status changes) |
| Done | busy -> idle transition (or Stop event) with `statusUpdatedAt` > `seenAt`; blue | yes: per-session `seenAt` |
| Working | `busy`; amber; time since it became busy | no |
| Idle | `idle` with `seenAt >= statusUpdatedAt`; hollow circle | `seenAt` comparison |
| Pinned | user flag overlaid on any state; the row keeps its state icon and leaves its state group (lead derivation above) | yes: persisted `pinned` |
| shell | no herdr equivalent (herdr has `unknown`); shown greyed in or below Idle (decision 44 maps it to Working) | no |

- Seen: herdr keeps it per client; we need our own `seenAt` per session, stored server-side; "viewed" = opening the session or replying.
- After a reply `waiting` becomes `busy` (row moves to Working); if the agent finishes before you look, it lands in Done (correct).
- Counters per group; tab title or badge shows needs-you plus done.
- Sort within group (herdr undocumented, ours is a proposal): Needs you and Done oldest first, Working and Idle most recent first, Pinned in pin order.
- Staleness: herdr warns detection can misread blocked as idle; our registry/hook data should be more reliable, but show the data age and flag a stale `statusUpdatedAt`.

## 5. Variant concepts

| # | Name | Layout | Best ideas | Risk |
|---|---|---|---|---|
| A | Herdr groups (reference) | grouped list Pinned, Needs you, Done, Working, Idle with counts | counted headers; time in state; `b/w/i/d` filter keys | long Idle group pushes rows down: collapse Idle |
| B | Triage inbox | only Needs you and Done as a Linear-style queue, detail pane with inline reply | digit decision keys; snooze; waitingFor reason label | hides working agents, trust issue |
| C | Split tabs | Superhuman-style tabs with counts Needs you, Done, Working, All; Tab moves | counts on tabs; Tab/Shift-Tab; first non-empty tab auto-selected | hides state you are not looking at |
| D | Project tree | folders (cwd) as parents, sessions beneath; parent rolls up to worst child (blocked wins) | rollup colour on collapsed parent; `+/-`; sub-agents nested | depth slows scanning |
| E | Status tiles wall | grid of cards: big state colour, last tool, tokens, running tool calls | wall-board glance; running-tool spinner; token sparkline | low density at 10+ sessions, colour-only encoding |
| F | Kanban | columns Working, Needs you, Done, Idle | column counts; card age; drag to pin | cards jump columns on every state change |
| G | Dense table | htop style, sortable: state, project, session, harness, age, last tool, tokens, sub-agents | click-to-sort; `/` filter; column picker | no triage emphasis unless default sort is state-first |
| H | Master-detail | compact list (variant A rows) left, log and reply pane right with collapsed tool calls; selecting marks seen | collapsed tool-call groups; reply box fixed at bottom; sub-agents strip (Warp pill bar) | narrow screens |
| I | Command palette first | Cmd+K list over a minimal page, `/` search over name, project, path (herdr Goto model) | type-to-jump; filter prefixes; recent first | poor discoverability |
| J | Tagged batch | variant A plus tmux-style tagging; one reply or approval to all tagged | tag all in group; undo toast; per-row shortcut keys | mass-approval accidents: confirmation and waitingFor text per row |

## 6. Recommendation

- Default: A, with H's right-hand detail pane when a row is selected (matches herdr habits; needs only `seenAt` and a pin flag).
- First A/B comparisons: A vs D (flat groups vs project tree), A vs B (full list vs triage inbox), A vs G (groups vs dense table).
- Decide before building: `seenAt` global or per browser; pin ordering; whether pinned rows leave their state group (answered by the lead's derivation in section 1); sort within groups.
- Side effects: notifications (toast and sound, separate request sound as in herdr) use the same state model; tab-title counter of needs-you; the CLI can reuse the same groups (`b/w/i/d` filters).
