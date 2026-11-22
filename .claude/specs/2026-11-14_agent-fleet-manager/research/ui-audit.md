# UI audit of the agent-manager web module (2026-11-21)

Method: isolated app-core (port 48732, `poc/scripts/ui-dev.sh`) + fake registry/transcripts + the module's fake daemon (`poc/scripts/ui-audit-env.mjs`, no claude, no Haiku, no hc terminal). agent-browser, headless, session `ui-audit`. Viewports 1440x900, 1024x700, 390x800; light and dark (the shell supports both).
Screenshots (throwaway, do not commit): `poc/results/ui-audit/` (before: `*-1440.png`, `*-1024.png`, `*-390.png`; after: `after-*.png`; variants: `variants/`).
Scripts (throwaway): `poc/scripts/ui-audit-env.mjs`, `ui-audit-shoot.sh`, `ui-audit-variants.sh`, `ui-audit-dom.js`.

## Defects

Status: FIXED = fixed in this run, OPEN = not fixed.

| # | Surface | Defect | Sev | Fix | Status | Screenshot |
|---|---|---|---|---|---|---|
| D1 | Tree/Groups/Inbox rows (owned) | Host and state chips are inline after the name: they overlap each other and crush the name to "flo...", "d." | High | Detail line and chips share a wrapping second line; "Waiting" chip dropped from list rows (icon + reason already say it) unless several requests wait | FIXED (Tree: all densities; Groups/Inbox: wrapping) | tree-1440, after-detail-1440 |
| D2 | Detail header | 4-5 rows tall (title, cwd, chips, id, host/state, actions, mode, reason): at 1024x700 the log is 15 px high | High | Host/state/actions in one row; status chips collapsible (default closed under 800 px of height, choice kept); header capped at 50vh | FIXED | detail-hc-1024, after-detail-hc-1024 |
| D3 | Mobile 390 | Toolbar overflows the screen (cut "Alive sessions"), stays above the detail | High | Toolbar wraps; hidden below lg while a session is open (the detail has its own Back button) | FIXED | list-390, after-list-390 |
| D4 | Detail header | Same fact said three times (Needs you chip, "Waiting for permission" chip, red reason line) | Med | Red reason hidden when a Web permission card is shown | FIXED | detail-owned-perm-1440 |
| D5 | Move button | Label "Move to herdr-core (interrupts 8 running items)" is long, wraps and overlaps on 390 | Med | A/B question 4 (default: short button + badge; full words kept for screen readers) | FIXED (A/B) | detail-hc-390 |
| D6 | New session dialog | Jargon "(X1)", "(X3)", "(X2)" next to the host names | Med | Tags removed from the dialog | FIXED | dialog-launch-1440 |
| D7 | Row action buttons | Sub-agent chevron, Move-to-group and group Edit are 16x16 (WCAG 2.2 target size is 24) | Med | 24x24 | FIXED (Tree and group header) | measured by `ui-audit-dom.js` |
| D8 | Permission mode | Label "Permission mode" next to a wide select costs a row | Low | Visible label "Mode", accessible name unchanged | FIXED | after-detail-1440 |
| D9 | Selected row | Chevron/state icon centered on a multi-line row | Low | Top-aligned on multi-line rows | FIXED | after-detail-1440 |
| D10 | Launch dialog | At 900 px high the Name field and the buttons are below the fold | Med | Button row of every dialog (`DIALOG_FOOTER`) sticks to the bottom of the scrolling body | FIXED | dialog-launch-1440 |
| D11 | Host names | The Move button said "herdr-core" while the badge said "Terminal" | Low | See Decision H1 | FIXED | |
| D12 | Move confirm dialog | Wall of bullets for a busy session (8 reasons) | Low | Reasons grouped by kind (title, count, one consequence line), 3 details visible, "Show N more"; red "Move anyway" vs plain Cancel (focus on Cancel) | FIXED | dialog-switch-1440 |
| D13 | Background session header | Three explanation lines under the greyed-out Interrupt and Mode | Low | One expandable note ("Why are Interrupt and Permission mode not available?") | FIXED | detail-bg-1440 |
| D14 | Shell at 390 | The shell's own header overflows by 60 px (app-core, not this module) | Low | Report to app-core | OPEN | after-list-390 |
| D15 | Toolbar at 1024 | Two toolbar rows (80 px) | Low | Under 1280 px: icon-only modes and New group, count as a number, short "Alive" labels; measured 45 px, one row at 1024 | FIXED | detail-hc-1024 |

Second pass (surfaces not reviewed in the first):

| # | Surface | Finding | Sev | Status |
|---|---|---|---|---|
| D16 | Table page | `nowrap` on Session/Folder/Detail pushed Status and the next columns out of the table (clipped, no scrollbar) | High | FIXED (columns wrap, `backend/columns.ts`) |
| D17 | Page notices | Unreadable registry file and unreadable guardrails counters were DSL pills above the workspace (pushed the page down, no fix given) | Med | FIXED: banners inside the workspace; the text now says where the folder is and what to do |
| D18 | hc approval card | A "cannot be answered from here" note sat on the red alert background | Low | FIXED: neutral background unless there is a dialog to answer |
| D19 | Daemon down | Previously owned sessions silently become plain rows (no Stop/Resume/Move) and nothing says why; only the New session dialog and sends explain | Med | OPEN, your decision: a permanent banner would nag people who never run the daemon. Option: show it only when `owned-sessions.json` lists sessions |
| D20 | A/B dock | The fold state (`ab.collapsed`) was lost on every load: the shell mounts the dock before the tests are enabled and it reads storage only at mount (dsl-ui `usePersistentChoice`) | Med | FIXED by dsl-ui 2026.11.22-369 (workaround removed) (re-announces the stored state); the real fix belongs to dsl-ui |
| D21 | A/B dock | Even folded, its pill sits bottom centre and can touch the left of "Interrupt now" | Low | OPEN (library placement) |
| D22 | Loading skeleton | Could not be caught: the local page answers in under one frame | - | NOT VERIFIED |

Measured, no defect: layout shift on poll refresh (3 polls: selected row, log and composer boxes identical, `poc/scripts/ui-audit-shift.js`); drag and drop with real mouse events (a row dropped on a group moved, count 1 to 2) and the keyboard alternative (M key, Alt+Up/Down); Guardrails page (readable, the long list scrolls); Esc, focus trap, aria, reduced motion and dark mode as in the first pass.
Not verified: the answerable hc approval card (needs a real herdr-core terminal), contrast ratios by tool, the loading skeleton.

## Decisions

- H1 (host names): three names everywhere (list chips, header, tooltips, dialogs, Move button): **Web** (a Claude Code child owned by the daemon), **Terminal** (a herdr-core terminal), **Background** (`claude --bg`, hosted by the Claude Code supervisor). The launch dialog adds "session" ("Web session"). "herdr-core" stays only where the mechanism is the point (a tooltip, the confirmation of a move: "as a Terminal session (herdr-core terminal t7)"). The codes X1/X2/X3 are not shown.
- Header on a phone: the status chips are closed by default under 600 px of width or 800 px of height, one line (model, context) stays; the toggle remembers the user's choice.

## A/B questions

All wired into the real Agents page behind one dock (bottom centre, dev or `--ab-tests` only). Choice kept in `localStorage ab.<id>`; a link `?ab.<id>=<option>` forces one. Declared in `logic/uiVariants.ts`, mounted in `components/AgentWorkspace.tsx`. Verified with agent-browser on the real page: each option screenshotted (`variants/`), a dock click persisted (`ab.ui-tree-density=compact`) and survived a reload. Default = recommendation.

Feedback of 2026-11-22 applied: Thread action baked in (always visible, top right of the row), status chips baked in (Soft), Tree rows keep Compact and gain three Herdr rows, Header actions redone, Move readiness and Group header made visible without a daemon or a custom group. Screenshots (throwaway): `poc/results/ui-audit/r2-*.png`.

| Question (dock id) | Options (default first) | Notes |
|---|---|---|
| Header actions (`ui-header-actions`) | **line** / line-menu / detailed | Whole header on ONE line (name, state, age, folder shortened in the middle, branch, model, context, Move readiness, role, tokens, duration, program, session id, pid) with the actions as icons at the right; what does not fit goes, last first, into a +N chip; below the bare line the name shrinks and the state is an icon. line-menu: only Fork stays an icon, Pin and Mark as seen in one menu. detailed: the previous three rows, kept to compare. Owned-session controls (host, state, Interrupt, Stop, Move, Resume, Forget) are icons in the line; the permission mode of a live Web session keeps a thin row under it; below 600 px the actions wrap under the line. Removed: inline/menu/split (they only moved three icons, the three rows stayed). |
| Tree rows (`ui-tree-density`) | **compact** / herdr-line / herdr-tinted / herdr-name | Herdr rows: 31 px, program icon, bold name, muted folder, age, state light (blue dot finished unseen, spinner working, red "Needs you" pill, grey ring idle). Tinted: red or blue row background and a gold outline and gradient on the open row, colours in `--am-herdr-*` of `styles/agents.css`. Name only: no folder text. The host is in the tooltip of the program icon. Removed: comfortable, card (user prefers compact). |
| Move readiness (`ui-switch-readiness`) | **badge** / amber button / banner | The readiness badge ("Free to move", "Busy: N running", "Unknown: ...") shows in the header of EVERY live session (`adoptReadiness` is computed for discovered sessions too: transcript tail and registry, not the daemon). The Move button exists only for owned Web or Terminal sessions; others say why in the badge tooltip (not launched by agent-manager: adoption not built; background: hosted by the supervisor). Daemon down: "Daemon not running: agent-manager start --detach". |
| Group header (`ui-group-header`) | **bar** / plain / pill | Applies to the folder headers of the Tree, the state groups of Groups mode and the custom groups, so it shows without creating a group. |

Baked in (no question any more): Thread action = base icon button "Start a thread from this message", always visible at the top right of the message row; status chips = Soft (tinted pill with icon).

Limits: the dark theme was not re-checked; the Mode row of owned Web sessions at 390 px was only fixed (max width) after the last screenshot.

## Header requests (checklist)

Source: user messages of the session record 287760ca (2026-11-22) and `.claude/session/principles.md`.

| # | Request (user) | Status |
|---|---|---|
| 1 | Use base dsl-ui components, no look-alikes (send, New session) | done: header uses IconButton, ButtonAction, Collapsible; `ui/` look-alikes replaced (#70, #75) |
| 2 | No spacing between the buttons and the select at the top right of the toolbar (image 15) | done (#79) |
| 3 | Context gauge: percent only, no icon, no bar, no tilde, colour kept, against the auto-compact point | done (#80) |
| 4 | Status line on ONE row, no icon for session id, model, time; role keeps its icon; CCv2.1.325, OC, Cx | done (#81), and now merged into the one-line header |
| 5 | "I asked for ONE line: name, state, etc., for all three rows, not just one" (2026-11-22, after the A/B test) | done in the `line` and `line-menu` looks; `detailed` keeps the rows on purpose |
| 6 | Fork an agent; Thread from a message; Move between hosts | Fork: icon in the header; Thread: icon at the top right of each message; Move: icon coloured by readiness, in the line (owned sessions) |
| 7 | The Adopt/Move button changes colour when something runs (tool, turn, sub-agent, background) | done: amber outline icon when busy or unknown, words in its name; readiness badge for every session |
| 8 | Explain where the A/B tests are | each dock hint says where the variant shows |
| 9 | Actions need the daemon: no click that cannot work | done: Stop, Interrupt, Resume, Forget, mode, Fork, Thread, Move off with the fix command |

## Side effects worth a look

- `RowMarks` is shared by Groups and Inbox: only the wrapping fix applies there; the density/icon-only variants apply to the Tree only.
- `docs/` or user notes that mention "(X1)" in the launch dialog no longer match.

## Base components

2026-11-22 (todos #75, #79, #70). Every button, field and select of the module is a `@wadeck-app/dsl-ui` component with default variants: `ButtonAction` (primary/secondary/danger/danger-outline, `size` sm in rows and banners, md in the toolbar and dialogs), `IconButton` (send, attach, close, pin, fork, popover triggers), `TabButton` (priority toggle, "Show commands"), `CompactSelect`, `FieldText`, `FieldSelect`, `FieldWrapper`, `Switch`, `Radio`, `Skeleton`, `DialogFooter`, `HorizontalStack` (toolbar spacing, `gap-2`, `wrap`). Deleted: `ui/IconButton`, `ui/ListSkeleton`, `launch/Field`, `DIALOG_FOOTER`. `FOCUS_RING` moved to `ui/focusRing.ts` for the custom rows below.

Kept custom, with the reason:

| Component | Reason |
|---|---|
| `ui/Modal`, `ui/ConfirmDialog` (built on base buttons and `DialogFooter`) | base `Dialog`: no max-height or scroll (buttons fall below the fold, audit D10), no way to block Escape/backdrop while a request runs, renders in a portal outside `.agents-scope`; base `ConfirmDialog` has no busy state, error line or rich children |
| `ui/Tooltip` | base `Tooltip` is an absolutely positioned CSS hover span: clipped by scrolling lists, no flip/clamp at the viewport edge, no delay (the failure `placeTooltip` fixes) |
| `ui/Banner` | no base alert/banner component |
| Panels of `ShortcutsHelp`, `ViewOptionsControl`, `DensityControl`, `ActionsMenu` | not moved to base `Popover`: not verified that its Radix portal keeps `.agents-scope` utilities and the focus-on-open and Escape behavior the tests pin. Triggers are base `IconButton`. Follow-up |
| `ModeToggle` | segmented radiogroup with arrow keys; no base segmented control (`Tabs` navigates, `RadioGroup` is a form list) |
| Tree/group/inbox rows, sub-agent rows, log row headers, folder rows, `MoveToGroupDialog` options, group color swatches, disclosure toggles, inline text links | selectable rows, `aria-expanded` disclosures and links, not actions: no base equivalent with this semantics |
| `TransportPicker` trigger, `TransportRow` info icon | text + icon popover trigger with `aria-expanded`; the base icon button is a fixed square. The info icon is a tooltip anchor |
| Status chips (`chipSkin`, `stateLook`) | three A/B looks (soft, outline, dot) with state icons; base `Badge` has solid/subtle only |
| `SearchBox`, folder inputs, composer textarea, `MoveToGroupDialog` / `NewGroupControl` inline inputs | icon + counter overlay, auto-growing, or an input beside a button: `FieldText` forces a visible label above and full width |

Behavior changes from the base buttons:
- Hints that were rich tooltips on Send and Attach are now the native `title` (base `IconButton` sets `title` to its label).
- Move: base buttons take no `data-*`; `data-adopt-button`, `data-readiness`, `data-tone` and the title sit on a wrapper span. The amber "warning" tone is the base `danger-outline` variant (no base warning variant); the sr-only detail follows the button instead of being inside it.
- Interrupt armed: Send turns base `danger` (was amber); the "Interrupt now" toggle turns `danger-outline`.
- Disabled buttons with a reason keep a hidden inline base tooltip in the DOM: tests use `detail/status/liveTooltip.ts` to find the module tooltip.
- Toolbar (#79): `HorizontalStack gap-2 wrap`; checked at 1440, 1024 and 390 px (`poc/results/ui-audit/toolbar-*.png`, throwaway).

## Context gauge, status line row, transport popup (2026-11-22, todos #80, #81, #78)

Marks: [D] documented (code.claude.com/docs, fetched 2026-11-22), [M] measured on local transcripts, [U] unknown.

### Context gauge (#80)

The chip shows only a percentage, coloured (green, yellow from 70 %, red from 90 %), relative to the AUTO-COMPACT point, not to the window. Tooltip: tokens used, auto-compact point, window, the assumption.

- [D] model-config, "Default auto-compact thresholds": models with a native 1M window (Fable, Sonnet 5+, Haiku 5.5, Opus 4.7+) "compact before the window fills, at about 967K tokens by default"; Sonnet 4.6 and Opus 4.6 without extended context "compact at the 200K boundary"; `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` makes native-1M models compact at 200K.
- [D] Same page: the window can be set with `/autocompact` (saved per model in `modelSettings`), `autoCompactWindow`, `--autocompact`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`; "Claude Code caps it at the model's context window". The status line `used_percentage` "measures against the model's full context window" (so it is not the auto-compact share).
- [D] The docs give 967K for 1M but no number for a 200K window.
- [M] 179 `compact_boundary` lines with `trigger: auto` in `~/.claude/projects` (preTokens): 69 between 167,000 and 169,999 (the sampled files are Sonnet 4.6 sessions, 200k window), 48 between 466,000 and 470,999 (consistent with a 500k window, not proven), a few at 935k-1,000k. Windows minus about 33k: 200k -> 167k, 500k -> 467k, 1M -> 967k (matches [D]). Rule used: `compactAt = window - 33,000` (`AUTO_COMPACT_BUFFER`).
- [M] Manual compactions (`trigger: manual`) happen at any size: not evidence for the point.
- [U] The window and the point actually in force for a session: not in the transcript or the registry. A window lowered with `/autocompact`, `autoCompactWindow` or the env variable is invisible here, so the percentage then UNDER-states how close the session is. The tooltip says so; the chip never claims exactness.
- [U] Whether Opus 4.7+ sessions run the 1M window in this account: the docs say native 1M, two sessions that auto-compacted at 167k hold Opus 4.7 messages next to Sonnet 4.6 ones, which is not conclusive. The model table now uses the docs for Opus 4.7+, Haiku 5.5 and Fable (`documentedWindow`, source `table-documented`), weaker than `provenWindow`.
- Changed: `contextUsedPct.value` is `round(contextTokens / compactAtTokens * 100)` (clamped 0..100); the DTO also carries `compactAtTokens` and `usedTokens`; core `rollup.compactPct` next to `usedPct` (share of the window, kept).

### Status line row (#81)

One row of chips under the folder line: model, context, role and bypasses always; tokens, duration, session id, program and pid while they fit. Measured, not guessed (`useChipFit`): while the row overflows the least important chip leaves (pid, program, session id, duration, tokens) into a `+N` chip whose tooltip lists them; only when nothing is left to drop does the row wrap. No icon on the model, duration and session id; the role keeps its icon. The program chip reads `CCv2.1.325` (OpenCode `OC`, Codex `Cx`, full name in the tooltip; an unknown program is shown as it is). The registry only holds Claude Code today (`backend/present.ts`, `logic/owned.ts` write "Claude Code <version>").
Limit: the folder path stays on its own line above (a path of 40+ characters cannot share the row); in a pane under about 300 px (1024 px wide window with the list open) only model and context fit and the rest is behind `+5`.

### Transport popup (#78)

One compact row per transport: status icon, name, badges (In use, Default, This session), actions "Use here" and "Make default" (only on an available row), one line under it (available: "Ready, peer message"; unavailable: the first clause of the reason, at most 70 characters, plus the fix: a command in code with a copy button, else the first clause). The whole reason, the fix sentence, how it delivers and the typed-delivery warning are behind a per-row "Details" toggle. No A/B question: the two layouts were not in doubt (the user's request was explicit); the dock was not touched.

## Log: tool meta and filters (2026-11-22, todos #76, #77)

Marks: [D] documented, [M] measured on the 40 newest local transcripts (`poc/scripts/probe-tool-meta*.mjs`, read-only, shapes only), [U] unknown. No A/B question: one layout, the request was explicit.

### Tool meta (#76)

`ToolCallEntry.meta` (additive, core `toolMeta.ts`): computed from the WHOLE tool_use input (the kept `input` is cut at 8 KiB) and from `toolUseResult` of the result line. A field that cannot be read is absent, never 0. `toolUseResult` is ignored when the line holds several tool_result blocks.

| Tool | Source | Chips |
|---|---|---|
| Edit | [M] result `structuredPatch` (hunk `lines` starting `+`/`-`) exact; else input old/new strings with common lines trimmed (`churnApprox`, shown `~`) | `+12 -3`; none when the call failed |
| Write | [M] result `type` create/update; create: lines of `content`; update: patch | `+N -0`, `new` |
| MultiEdit | [U] not in the sample; documented input `edits[]` | churn, `N edits` |
| Bash | [M] input `run_in_background`, `timeout`; result text lines; `toolUseResult.interrupted`, `backgroundTaskId`; duration = line timestamps (already shown) | `bg`, `exit N`, `interrupted`, `N lines` |
| Read | [M] `toolUseResult.file` `numLines/startLine/totalLines`; `type: image` | `10-59 of 400`, `120 lines`, `image` |
| Grep | [M] `mode`, `numFiles` (files mode only: it is 0 in the other modes), `numLines` (content: matches AND context), `numMatches` (count), `appliedLimit` | `12 files`, `20 lines`, `31 matches`, `cut` |
| Glob | [M] `numFiles`, `truncated` | `100 files`, `cut` |
| WebFetch | [M] host of input `url`; `code`, `bytes` | host, status (red from 400), size |
| Agent/Task | [M] input `subagent_type`, `run_in_background` | type, `bg` |
| MCP | name `mcp__<server>__<tool>` (a server containing `__` splits wrong) | row label = tool, chip `mcp <server>` |

- [M] Bash has no exit code field: "Exit code N" is the first line of an error result; a hook-blocked call has none (no code shown).
- [U] Sync Agent result (duration, tool count): only the async shape was seen (`isAsync, status, agentId`); nothing is read. A sub-agent tool count would need its own transcript.
- [U] WebSearch result shape; row summary already shows the query, so no chip.
- Group row: `3 files +45 -12` (failed edits excluded, `~` while an edit runs), `2 bash 14 s` (omitted time while one runs), `2 reads 480 lines` (only when every read says it); native tooltip = one line per call.
- Orphan results (call outside the window) keep no meta: the name is unknown.

### Hooks and filters (#77)

- [M] Hooks are `attachment` lines (type is the first key of the attachment): `hook_success` (1581 in the sample), `hook_non_blocking_error`, `hook_cancelled` (`timedOut`), `hook_system_message`, `async_hook_response`; fields `hookEvent`, `hookName` ("PreToolUse:Bash"), `command`, `durationMs`, `exitCode`, `stdout`/`stderr`/`content`, `toolUseID` (the tool_use id for Pre/PostToolUse). They were skipped before; the tailer now parses them (`HookEntry`, output bounded at 500 chars, ANSI stripped). Other attachments stay skipped. The Stop summary stays a `system-notice` (`stop-hook`) and counts as a hook.
- [M] A hook line sits between the tool_use and its result: in a run of calls it is held and drawn after the group, so groups do not split.
- [M] A hook that blocks a call shows in the tool result ("PreToolUse:Bash hook error"), not as an attachment.
- Categories (`logFilters.ts`): hooks (off), tools (on), agent messages (on) = SendMessage, Agent/Task calls, prompts with source `peer` or `task-notification`, queue lines of those. A message sent from here (`webReply`) is not one.
- [U] `task-notification` covers background shell tasks and sub-agent results alike: the origin does not tell them apart, both are "agent messages".
- Counts are over the loaded entries only; the bar shows `N hidden` (tooltip by category), not one marker per run: hooks come twice per tool call, inline markers would split every group. Everything hidden says so in the log area. The call of the selected sub-agent is never hidden.
- Stored per browser in `agent-manager.log-filters.v1`; an unreadable value gives the defaults and a dismissible sentence.
- Not done: the "N new entries" button still counts hidden entries.

## Compact notices (2026-11-22, todo #90)

- One line per page, whatever the count: icon, sentence <= 70 characters, Copy fix (command between backticks of the message), Details (full text, file, why), Dismiss. Several notices: "N notices" + Show list + Dismiss all. Code: `ui/Notices.tsx`, `logic/notices.ts`.
- Dismissal is per message text in `sessionStorage` (`agent-manager.dismissedNotices`): a changed text shows again. A dismissed notice leaves a "N notices dismissed" button (toolbar; under the line on pages without one) that restores them. A storage that throws dismisses nothing.
- Transient page messages (refused action, search note, unknown mode) use the same line; their dismiss clears the page state instead.
- Table, Agents (registry error) and Guardrails pages use the registered component `agent-manager:PageNotices` (Guardrails problems go through `GuardrailsPage`). The kill-switch-ON alert stays a large red block on purpose. Dialog banners (launch, fork, thread, owned bar) are untouched.
- Fixed 2026-11-22 (#95): `ownedStateErrorText` said its "Fix: ..." sentence twice (`backend/daemon/ownedDown.ts`); the message of a `LaunchError` already holds it. Test: `backend/ownedDown.test.ts`.

## Custom mode, port of WAgents (2026-11-22, todo #91)

4th list mode (`?mode=custom`): every live agent inside the user's custom groups, the rest in a last Ungrouped bucket. Source: the Herdr mod `~/.config/herdr-app/mods/my-agents` (read only). The user's Herdr groups: Focus 5, Regular 6, Secondary 3, Meta 6, Icebox 2, all manual, no colors, 3 flagged agents.

| WAgents | Here |
|---|---|
| groups, order, groupcfg, marks in `shared.json` | the existing custom groups of `agents-user-state.json` plus additive fields: group `sort` (manual, urgency, name, recent), group `bodyColor`, top-level `marks` `{flag, unread, at}` per session. Version stays 1 (absent fields read as manual / none / {}); an older module rewriting the file drops the new fields |
| header color | the existing group `color` |
| body color, header palette (hex) | the 8 named colors of the groups (theme hues) |
| `doDrop`, `accepts`, `dropLine` | `resolveDrop` (pure, tested): the held item is a parameter, so nothing is cleared before the target is validated. Hook `useCustomDnd` |
| drop rules | row of another group = join before it; header or strip under the last agent = end; same group = takes the target's place; non-manual group = ignored with a visible hint; header on header = reorder; Ungrouped = leave the group |
| `groupCfgMenu` | folder-cog popover (rename, order, header and body color; button to the existing group dialog). One design only, no A/B |
| `rowMenu` | right-click, context-menu key, kebab: Flag, Mark as unread, Move to a group |
| unread cleared on focus | cleared when the agent is selected through the list, keys or search (not by an address on load; marking the open agent keeps the mark) |
| `RANK` urgency, "Needs you" first | `ATTENTION` of `logic/states.ts` (needs-you, other, done, working, idle, ended), newest change first |
| `track` (done and idle are one state) | not needed: `statusUpdatedAt` comes from the registry and does not change when a finished agent is seen |
| `ROW_LAYOUTS`, `FOCUS_BGS`, settings menu, state colors | not ported. Rows are the Herdr rows of the `ui-tree-density` question (tinted by default in this mode); the open row is the gold outline of the tinted variant |
| sort modes priority, space, agent, machine | not ported (Tree, Groups and Inbox exist) |
| one-click groups | `POST /groups/preset {preset:"herdr"}`: Focus, Regular, Secondary, Meta, Icebox, only into an empty list (409 otherwise), never automatic |

- Routes `POST /groups/preset`, `POST /sessions/:sessionId/marks`, and the new fields of `POST /groups/:id` are not PIN-gated (`routeClasses.ts`). Marks of sessions absent for 14 days are pruned with the hourly pass.
- Follow-up, not built: import of the Herdr groups. Mapping: herdr terminal -> `hc get` foreground pid -> registry pid -> session id, then `agents.groups` / `agents.order` / `agents.marks`.
- Not built: the Tree's attention expansion of sub-agents; the Shortcuts help does not list M / Alt+arrows for this mode.

## Names cut in the Herdr rows (2026-11-22, todo #95)

Cause: the move and menu hover buttons were opacity-0 but kept their 20 px slot (plus gaps), and name and folder shrank together. Fix (`lists/HerdrRowBody.tsx`): the buttons float over the age and light (`absolute`, shown on hover and focus-within); name and folder sit in one clipped one-line box (`flex-wrap overflow-hidden`): the name takes what it needs, the folder wraps out of the box when less than 7 characters remain (so it is hidden, never squeezed); age and light never shrink; host stays in the program icon tooltip.

- Checked at list widths 300 and 400 (1440 px) and 390 px, Tree herdr-tinted and Custom: `poc/results/ui-audit/a-*.png`. Only a name longer than the pane is cut (a row with chevron, sub-agent count and the "Needs you" pill still cuts `agent-manager-owner` at 300 px).
- Tests: `lists/herdrRowBody.test.tsx` (classes only: jsdom has no layout).

## Permissions tab of the right rail (2026-11-22, todo #93)

The rail beside the log (was: sub-agents, only when there are some) now always exists and has two tabs: Sub-agents and Permissions (shield icon, badge = active bypasses of the session plus the other sessions of its project). A session with no sub-agents opens on Permissions, collapsed by default. On a phone (< 600 px) the open rail floats over the log.

- Data, all existing: `GET /guardrails/overview` (grants: category, mode, time left, uses, reason, session; read on selection and every 30 s, refresh button), `guardrailBlocks` of the row (counters by category, copy command buttons), link to the Guardrails page. Absence is a sentence ("No active bypass for this session."), a failed read is an alert, an answer of another shape is an error, never "no bypass".
- Add bypass and Revoke are drawn disabled; the single switch is `GUARDRAILS_WRITE_ENABLED = false` in `logic/permissions.ts`, tooltip "Needs the w-guardrails API (list/revoke/grant): not available yet". Turn it on only with the API and a PIN class for the routes.
- Code: `detail/permissions/`, `logic/permissions.ts`, rail in `detail/log/SubagentAside.tsx`. Tests: `detail/permissions/permissions.test.tsx`, `logic/permissions.test.ts`.
- Not seen with real data: the dev app has no grants file, so only the empty states were screenshotted (`b-permissions-*.png`); the populated list is covered by tests.

## Multi-selection and batch actions (2026-11-22, todo #94 part 1)

- Selection: checkbox on every row (hover, focus-within, or always once something is selected; out of the tab order), Shift click = range among the rows on screen, Ctrl or Cmd click = toggle, X ticks the focused row, Esc clears (not while a dialog is open), select-all in the toolbar, in Tree folders, custom groups and Custom mode blocks (indeterminate for some). State in `lists/selection.tsx` by lowercase session id, pruned when a session disappears. Groups and Inbox modes have row checkboxes but no group select-all.
- Selection UI: no A/B question; the default asked (hover / focus / when selecting) is the only one built.
- Batch bar (`batch/BatchBar.tsx`) above the list: Send a message..., Mark as seen (finished ones only), Pin / Unpin, Move to group (page group API, one move per session, not PIN-gated), Add / remove bypass (off, same switch and tooltip as the Permissions tab).
- Send dialog: recipients read once from the existing `GET /sessions/:id/reply/status` (2 at a time); a dead session or unavailable transport is listed unticked with its reason; "N will receive it"; over 20 ticked the button is off and says how many to untick. After the send the per-recipient results stay until closed, with Copy and a retry of the refused or failed ones (never a maybe-sent one). A new text or new ticks gets a new `requestId`; a failed request keeps the form, and sending again with the same id never messages a recipient twice.
- Route `POST /sessions/batch/reply {ids[], text, requestId?}` (sensitive: one PIN prompt, CSRF kept; threat-model T-21). Same send logic as the single reply (`sendOne` in `backend/replyRoutes.ts`), 2 at a time, at most 20 recipients (400 above, on duplicates, empty text, unknown fields). Result per recipient `{id, name, state: sent|queued|refused|maybe-sent|failed, reason}`: `maybe-sent` = `OutcomeUnknownError`, `refused` = any 4xx or the service's refused codes, `failed` = the rest. One audit line per recipient (the service writes it); message id = `<requestId>-<session id>`. Registered before `/sessions/:sessionId/reply`.
- Tests: `backend/batchReply.test.ts` (uses 3 idle child processes for live pids), `lists/selection.test.tsx`, `batch/*.test.*`, `backend/routeClasses.test.ts`.
- Not built: batch bypass add / remove (needs the w-guardrails API), group select-all in Groups and Inbox.
