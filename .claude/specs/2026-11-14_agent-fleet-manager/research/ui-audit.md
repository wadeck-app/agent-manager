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
| `ModeMenu` (was `ModeToggle`) | one icon button + `role=menu` of `menuitemradio` (no base menu with radio items: `ContextMenu` has none) |
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
- Toolbar icons (#109, #110, 2026-11-22): the notices button is a normal 36 px ghost icon button (16 px triangle) with a 16 px corner badge inside its box (`right-0.5 top-0.5`, 11 px tabular digits, "9+" above 9, severity token pair plus a surface-colour ring; contrast 6.84 light, 12.03 dark). The four mode buttons are ONE 36 px icon button (icon of the current mode, `List mode: <name>`) opening a `role=menu` of `menuitemradio` items with hint (`workspace/ModeMenu.tsx`; arrows, Home, End, Enter, Space, Esc; no per-mode shortcut and no Inbox count existed, none added). Screenshots `poc/results/ui-audit/toolbar-icons/` (throwaway).

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

- Superseded 2026-11-22 (#101, user: "it is a mess"): no inline line any more. ONE warning-triangle button with a count badge, shown only while a notice is active, colored by the worst severity (error over warning). It sits immediately left of New group in the right-aligned group of the Agents toolbar (left of New session in the modes without New group), and right-aligned on the title line (`PageTitle`) of Table and Guardrails (and of the Agents page when the registry cannot be listed, since no toolbar is drawn then). The panel under it lists compact rows: title, detail text (cut at 140 characters with More / Less), the action, Copy fix, a dismiss each, and Dismiss all. Escape and a press outside close it, the focus goes back to the button; at 390 px it spans the window (`fixed inset-x-2`, from sm it hangs from the button, `sm:w-96`). Code: `ui/Notices.tsx` (NoticesButton), `ui/NoticeRow.tsx`, `logic/notices.ts`. The component `agent-manager:PageNotices` is gone.
- Dismissal is per message text in `sessionStorage` (`agent-manager.dismissedNotices`): a changed text shows again. A storage that refuses is NOT silent any more: the dismissal still hides the notice for this page load and the panel says "Not remembered: this browser refuses to store the dismissal (<reason>). The notice comes back after a reload." While at least one notice stays active, the panel offers "Restore N dismissed". Known gap: when every notice is dismissed the button is gone (by request), so the restore is only reachable while another notice is active; a dismissed notice stays hidden for the browser session unless its text changes.
- Transient page messages (refused action, search note, unknown mode) are rows of the same panel; their dismiss clears the page state instead.
- The kill-switch-ON alert stays a large red block on purpose. Dialog banners (launch, fork, thread, owned bar) are untouched.

## Row highlights by state (2026-11-22, todo #103)

Measured on an isolated app-core (fake data), light and dark, computed background of every row (`poc/results/ui-audit/highlights/measure.mjs`, `before.json`, `after.json`, screenshots `before-*` / `after-*`).

- Before: the tint of "needs you" and "finished and unseen" existed only in the Tree variant C (Herdr tinted) and in Custom; the flag tint (orange) only in Custom; the Tree default (A Compact), Groups and Inbox had NO tint for needs-you, unseen or flagged, only the open row (primary border and light primary background). Pinned: icon only, in every mode (the Herdr mod does not tint it either). Multi-selected: a primary ring in every mode, no background.
- After: one function (`stateTint`, `logic/herdrRow.ts`) gives the background in every mode and every row shape: needs you (red, `--am-herdr-needs-bg`), flagged (orange token), finished and unseen or idle marked unread (blue, `--am-herdr-unseen-bg`), in the order of the Herdr WAgents mod (needs you, flag, blue dot). The open row keeps its own look (primary light; gold outline and gradient in variant C and in Custom). Muted text on a row uses `text-muted-tint` (the plain muted token measured 3.62:1 on the red tint). A flagged row has a Flag icon with the word Flagged for a screen reader in every mode (it was only in the Herdr rows).
- Lowest contrast measured after the change: name text 4.61:1 (Groups, red tint, light), muted text 4.59:1 (dark, gold gradient end). Before the muted fix the red tint gave 3.62:1 (light) and 4.1:1 (dark).
- Fixed 2026-11-22 (#95): `ownedStateErrorText` said its "Fix: ..." sentence twice (`backend/daemon/ownedDown.ts`); the message of a `LaunchError` already holds it. Test: `backend/ownedDown.test.ts`.

## Custom mode, port of WAgents (2026-11-22, todo #91)

4th list mode (`?mode=custom`): every live agent inside the user's custom groups, the rest in a last Ungrouped bucket. Source: the Herdr mod `~/.config/herdr-app/mods/my-agents` (read only). Only user-made groups exist: no preset and no import of Herdr groups (user decision 2026-11-22; the one-click preset and `POST /groups/preset` were removed).

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

- Routes `POST /sessions/:sessionId/marks`, and the new fields of `POST /groups/:id` are not PIN-gated (`routeClasses.ts`). Marks of sessions absent for 14 days are pruned with the hourly pass.
- Not built: the Tree's attention expansion of sub-agents; the Shortcuts help does not list M / Alt+arrows for this mode.

## Names cut in the Herdr rows (2026-11-22, todo #95)

Cause: the move and menu hover buttons were opacity-0 but kept their 20 px slot (plus gaps), and name and folder shrank together. Fix (`lists/HerdrRowBody.tsx`): the buttons float over the age and light (`absolute`, shown on hover and focus-within); name and folder sit in one clipped one-line box (`flex-wrap overflow-hidden`): the name takes what it needs, the folder wraps out of the box when less than 7 characters remain (so it is hidden, never squeezed); age and light never shrink; host stays in the program icon tooltip.

- Checked at list widths 300 and 400 (1440 px) and 390 px, Tree herdr-tinted and Custom: `poc/results/ui-audit/a-*.png`. Only a name longer than the pane is cut (a row with chevron, sub-agent count and the "Needs you" pill still cuts `agent-manager-owner` at 300 px).
- Tests: `lists/herdrRowBody.test.tsx` (classes only: jsdom has no layout).

## Permissions tab of the right rail (2026-11-22, todo #93)

The rail beside the log (was: sub-agents, only when there are some) now always exists and has two tabs: Sub-agents and Permissions (shield icon, badge = active bypasses of the session plus the other sessions of its project). A session with no sub-agents opens on Permissions, collapsed by default. On a phone (< 600 px) the open rail floats over the log.

- Data, all existing: `GET /guardrails/overview` (grants: category, mode, time left, uses, reason, session; read on selection and every 30 s, refresh button), `guardrailBlocks` of the row (counters by category, copy command buttons), link to the Guardrails page. Absence is a sentence ("No active bypass for this session."), a failed read is an alert, an answer of another shape is an error, never "no bypass".
- Superseded: Add bypass and Revoke are live (sections below). No write flag remains.
- Code: `detail/permissions/`, `logic/permissions.ts`, rail in `detail/log/SubagentAside.tsx`. Tests: `detail/permissions/permissions.test.tsx`, `logic/permissions.test.ts`.
- Not seen with real data: the dev app has no grants file, so only the empty states were screenshotted (`b-permissions-*.png`); the populated list is covered by tests.

## Multi-selection and batch actions (2026-11-22, todo #94 part 1)

- Selection: checkbox on every row (hover, focus-within, or always once something is selected; out of the tab order), Shift click = range among the rows on screen, Ctrl or Cmd click = toggle, X ticks the focused row, Esc clears (not while a dialog is open), select-all in the toolbar, in Tree folders, custom groups and Custom mode blocks (indeterminate for some). State in `lists/selection.tsx` by lowercase session id, pruned when a session disappears. Groups and Inbox modes have row checkboxes but no group select-all.
- Selection UI: no A/B question; the default asked (hover / focus / when selecting) is the only one built.
- Batch bar (`batch/BatchBar.tsx`) above the list: Send a message..., Mark as seen (finished ones only), Pin / Unpin, Move to group (page group API, one move per session, not PIN-gated), Add bypass and Remove bypass (2026-11-23, #94b, see below).
- Send dialog: recipients read once from the existing `GET /sessions/:id/reply/status` (2 at a time); a dead session or unavailable transport is listed unticked with its reason; "N will receive it"; over 20 ticked the button is off and says how many to untick. After the send the per-recipient results stay until closed, with Copy and a retry of the refused or failed ones (never a maybe-sent one). A new text or new ticks gets a new `requestId`; a failed request keeps the form, and sending again with the same id never messages a recipient twice.
- Route `POST /sessions/batch/reply {ids[], text, requestId?}` (sensitive: one PIN prompt, CSRF kept; threat-model T-21). Same send logic as the single reply (`sendOne` in `backend/replyRoutes.ts`), 2 at a time, at most 20 recipients (400 above, on duplicates, empty text, unknown fields). Result per recipient `{id, name, state: sent|queued|refused|maybe-sent|failed, reason}`: `maybe-sent` = `OutcomeUnknownError`, `refused` = any 4xx or the service's refused codes, `failed` = the rest. One audit line per recipient (the service writes it); message id = `<requestId>-<session id>`. Registered before `/sessions/:sessionId/reply`.
- Tests: `backend/batchReply.test.ts` (uses 3 idle child processes for live pids), `lists/selection.test.tsx`, `batch/*.test.*`, `backend/routeClasses.test.ts`.
- Not built: group select-all in Groups and Inbox.
- Batch bypass (#94b, threat-model T-24): `POST /guardrails/batch/grants {requestId, category, mode, rationale, sessions[]}` and `POST /guardrails/batch/revoke {requestId, items[{sessionId, grantId}]}`, both sensitive. Same logic as the single routes (`createGrantCore`, `revokeGrant`), 2 at a time, max 20 sessions (60 revokes), each session in its own folder. A PIN token that expires mid-batch stops new grants: the rest is `not-attempted`. Same `requestId` and body replays the earlier results.
- Add bypass dialog (`batch/BatchAddBypassDialog.tsx`): names of the sessions (collapsed above 5), one rules read per distinct folder, categories = intersection of the bypassable ones (a folder whose rules cannot be read is named in a warning and left out of the intersection; the server still refuses per session), duration, reason, confirm line "Allow rm once in 3 sessions", then granted / refused / failed / not attempted per session and a Retry button for the not-attempted ones only (never automatic, new `requestId`).
- Remove bypass dialog (`batch/BatchRemoveBypassDialog.tsx`): one grants read per session (2 at a time, progress), bypasses grouped by category with counts, nothing ticked at first, group and single ticks, confirm line "Remove 3 bypasses (rm 2, git-push 1) from 3 sessions", result per bypass.
- Tests: `backend/guardrailsBatchRoutes.test.ts`, `batch/batchBypass.test.ts`, `batch/batchBypassDialogs.test.tsx`, `batch/batchBar.test.tsx`.

## Permissions tab: list and revoke through the plugin admin CLI (2026-11-22, todo #93 step 1)

- Source of "This session": `GET /guardrails/sessions/:sessionId/grants` runs `node <admin.js> bypass list --cwd <dir> --session <full id> --json` (plugin >= 1.29.0, highest numeric version folder of `~/.claude/plugins/cache/local-marketplace/w-guardrails`). Contract and failure rules: threat-model T-22, code `backend/guardrailsAdmin.ts`.
- Revoke: button per grant, inline confirmation (category and time left), `POST /guardrails/grants/:id/revoke {sessionId}` (PIN, CSRF), list then revoke, one audit line. Countdown ticks every second from the expiry; the list is re-read every 30 s and after a revoke.
- Fallback only when admin.js is missing (`code: not-installed`): the file reader, labelled "read from files (admin CLI not found)", no Revoke button. Any other CLI failure is an alert, not an empty list and not the files. "Other sessions of this project" stays read from the files (read-only).
- `GUARDRAILS_REVOKE_ENABLED = true`. There is no Add flag: Add bypass is on when the CLI answers (see the Add bypass section).
- cwd check (measured 2026-11-22): transcript lines carry `cwd` and it changes after a `cd` (1 of the 80 newest transcripts: `...\GerberWyss` then a temp folder). Of the 23 sessions in the registry, 0 had a registry cwd different from the last transcript cwd, so whether Claude Code updates the registry file after `cd` is NOT proven here (that session was not in the registry). The route uses the last transcript cwd (last 512 KiB), falls back to the registry cwd and says why (`cwd used: ...`).
- Real script, read-only: with `AGENT_MANAGER_INTEGRATION=1 AGENT_MANAGER_INTEGRATION_HOME=<real home>`, `bypass list` on an empty temp folder gives `grants: []` and a revoke of an unknown id gives the error JSON (passes).
- Not seen in a browser with real grants (no bypass exists on the dev app); covered by `cliGrants.test.tsx` and the route tests with a fake script.

## Font question (2026-11-22, task #87)

| Question (dock id) | Options (default first) | Notes |
|---|---|---|
| Font (`ui-font`) | **app** / geist / geist-mono | Geist = the UI font of the Herdr agents panel (the user's Herdr sets no font). B: text in Geist. C: also Geist Mono for `font-mono` parts (tool commands, ids, pids, paths); JetBrains Mono (the Herdr terminal font) is not embedded: the `geist` package has no JetBrains Mono. |

- Herdr has no font files on disk: the fonts are inside `herdr-app.exe`; its `THIRD-PARTY-NOTICES` lists Geist/Geist Mono and JetBrains Mono as SIL OFL 1.1 (`C:\Users\Wadeck\AppData\Local\Programs\herdr-app\`). The fonts come from npm `geist` 1.9.2 instead (OFL 1.1, `LICENSE.txt` copied to `src/backend/fonts/THIRD_PARTY_NOTICES.md`).
- `geist` is NOT a dependency: it has a required peer `next` (`npm install --dry-run` adds next, sharp, @swc/helpers, styled-jsx and their install scripts). The two variable woff2 (Geist 69488 B, Geist Mono 71212 B, all weights) are embedded as base64 by `src/backend/fonts/embed-fonts.ts` after `npm pack geist@1.9.2`.
- Why served by the backend: `app-core-cli package` ships only `backend.cjs`, `entries.mjs` and one `style.css` (no asset folder) and the CSP allows `font-src 'self'` with no `data:` fonts. Route `GET /api/modules/agent-manager/fonts/<name>-<version>.woff2` (immutable cache). `@font-face` is global by nature: families are named `AM Geist` / `AM Geist Mono` and used only under `.agents-scope[data-font]`.
- Size: backend.cjs +188 KB raw (base64), fonts alone 142 KB gzip; CSS +~1 KB. A fresh load with the default option downloads no font (measured: no `/fonts/` request, `AM Geist` unloaded).
- Verified (agent-browser, isolated app-core 48732): computed `font-family` of a list row = `"AM Geist", ui-sans-serif, ...` for B and C, `Inter` for A; `.font-mono` = `"AM Geist Mono", ...` only for C; font requests 200 (`font/woff2`). Screenshots `poc/results/ui-audit/font/`. The shell chrome (nav, header) stays Inter (outside the module scope).

## Permissions tab: Add bypass and Rules (2026-11-22, T-23)

- Add bypass (`detail/permissions/AddBypassDialog.tsx`): category select (bypassable only, each with its current decision and source; the most blocked one is preselected), segmented duration (once, 10 min, 30 min, 4 h; once by default), required one-line reason (300 characters, plain text, "shown in the plugin journal"), confirm line "Allow <category> for <duration> in <session> (<folder>)". PIN through the shared `appFetcher` path. Success: dialog closes, notice "Added a <category> bypass ...", list reloads (rows show "added from this page" for origin ui, another origin by name, uses left). Failure: alert in the dialog with the server text, choices kept.
- Off with the reason in words when the admin CLI is missing or answers an error; no flag.
- Rules section (`RulesSection.tsx`, collapsed): table category, now (denied, asks, allowed), source, bypass; a config error is a notice visible while collapsed. Read once per selection and on refresh, not on the 30 s timer (each read starts the plugin script).
- Routes: `POST /guardrails/sessions/:sessionId/grants` (PIN, CSRF), `GET /guardrails/sessions/:sessionId/rules`. Tests: `backend/guardrailsAddRoutes.test.ts`, `guardrailsAdminGrant.test.ts`, `detail/permissions/addBypass.test.tsx`, `logic/grantForm.test.ts`.

### Batch bar as a floating popup (2026-11-22, todo #108)

- `batch/BatchPopup.tsx`: pill at the bottom centre of the content area (fixed, `left` = `--ab-dock-inset-left` / `--app-shell-menu-width`, `right: 0`), portaled to body inside `<Scope>`, z-40 (dialogs are z-50: a batch dialog covers it). Role toolbar, same name, count, actions and Clear as before; fades in (16 ms later, 200 ms). `BatchBar` renders it; the dialogs sit beside the toolbar, not inside. The list column has no bar any more (only the select-all box in the toolbar).
- Above the A/B dock: AbDock publishes no height variable, so the frame is found by its `data-testid="ab-dock-frame"` (dsl-ui) and followed by a ResizeObserver plus window resize. bottom = window height - frame top + 8, plus 12 when the dock is open (its fold tab sits on its top edge). No dock = bottom 24 (normal outside the dev server).
- Reply box: the popup would cover it, so it publishes `--batch-popup-reserve` (24 + its height + 8) on the root and `Workspace` pads its bottom with it: the reply box lifts above the popup. Measured at 1280 and 768 (Send 1221..1257 x 634..670, popup top 696): no overlap. The reserve ignores the dock (the open dock already hides the reply box; folded, the popup sits about 38 px higher and overlaps the reply footer line).
- Measured (isolated app-core, dock open and folded, Tree and Custom, light and dark, 1280 / 768 / 390): gap to the dock top 8 px in all 24 cases; centre 760 / 504 / 230 = centre of the strip right of the menu; at 390 the actions wrap to a second row. 390 has a page horizontal overflow (450 > 390) that exists without a selection too (not from the popup). At 390 the list and the reply box never show together, so no overlap to check there.
- Tests: `batch/batchPopup.test.tsx` (placement, dock open / folded, ResizeObserver and window resize, reserve variable, transition, outside the list DOM), `batch/batchBar.test.tsx` unchanged and green. Screenshots: `poc/results/ui-audit/batch-popup/`.

## Responsive and coherence pass "lotc" (2026-11-23)

Isolated app-core 48761 (`poc/scripts/ui-audit-env.mjs` + `ui-dev.sh`), headless agent-browser, light and dark, 1280 / 768 / 390 x 800, A/B dock folded. Scripts `poc/scripts/lotc-shoot.sh`, `lotc-batch.sh`, `lotc-measure.js`; screenshots `poc/results/ui-audit/lotc/` (throwaway).

- Permission card (owned and hc): `detail/CardsDock.tsx` wraps both cards: `max-h-[35%]`, scrolls inside, shrinks before the log; the log wrapper keeps `min-h-[7rem]`. Command folded to 3 lines (`line-clamp-3`, more than 3 lines or 240 characters, "Show all (N lines, ...)" button; `permissionBlocks.ts`), description 2 lines, reason field label is screen-reader only and shown as the placeholder, buttons in one non-wrapping row, under 640 px the reason is full width under them. Measured: 1280 card 215 -> 170 px (fully visible), log 175 -> 203; 390 log 0 -> 171, reason input 40 -> 288 px wide, card 264 -> 216 (cap 200, scrolls inside). The 390 composer placeholder is short ("Message the agent") on a phone.
- Log filter chips: one row, scroll sideways (`flex-nowrap overflow-x-auto`), no more overlap of the rail.
- Background header at 390: `BgAttach compact` = one row (command, Copy icon, Details icon); explanations (what it waits on, why no Interrupt / Mode) in the details, open at once while the session waits. Measured: header + card ~450 -> 149 + 46 px, log ~20 -> 146 px. Wide layout unchanged. `BgLimits.tsx` holds the shared explanation.
- Batch popup, dock folded: the popup was already 8 px above the dock; the page reserve ignored the dock, so the reply box footer sat under the popup. The reserve now counts the folded dock (frame rect). Measured 1280 and 768: popup 696..738, dock top 746 (gap 8), reply box footer above the popup. Dock open unchanged (gap 20: 8 + the 12 px fold tab).
- One chip skin `ui/Chip.tsx` (20 px high, `px-2`, `text-xs`, soft fill + subtle border, variants neutral / info / warning / danger / success) and one `ui/CountBadge.tsx` (16 px min, circle or pill, tabular digits). Migrated: host chips, owned state, StateChip (Table), header state chip (`HeaderLine`, `DetailHeader`), Table harness chip, status row chips (`chipStyle.ts`), Move readiness badge, hc terminal chip, "1 of N", Herdr "Needs you" pill; counts: permission rail badge, Notices, guardrails Section, attachment count. Measured chips (all 20 high): icon-only host 34x20 (was 30x22), Table state 70..104x20, harness 144x20. Colour change by design: the two warm states (Working, Other) share the warning variant (were yellow and orange); status row chips text is the muted tint (was content).
- Icon buttons: `lists/RowIconButton.tsx` (28 px default, 36 px option, not a tab stop, click never selects the row) replaces the 7 hand-written row buttons (Herdr chevron, move, menu; Tree chevron, move; group settings; group edit). Herdr rows still 31 px, icons at the same x. Left over: dsl-ui IconButton `icon-xs` (20) and `icon-field` (38) exist but no row uses them now.
- Not verified: hover state of the row buttons on a real pointer (not screenshotted), chips at density S and L, the hc permission card in a browser (needs a herdr-core terminal; covered by tests), the composer at 390 with a long draft. The shell header overflow at 390 (D14) is now 140 px (was 60): not from this module.

## QA fix pass (2026-11-23)

Isolated app-core 48796 (`C:\Users\Wadeck\AppData\Local\Temp\am-qafix`, fake admin `fakeAdmin.cjs`, never the real plugin CLI), headless agent-browser, screenshots `poc/results/ui-audit/qafix/` (throwaway).

- D1 Escape and shift: `SelectionKeys` treated a focused checkbox input as a text field (`isTypingTarget`), so Escape did nothing after a mouse click on a row checkbox. Now only text-taking inputs, text areas, selects and editable boxes own Escape; an open dialog or menu still does. `RowCheckbox` ignored the shift key (it only toggled): `onChange` now reads `nativeEvent.shiftKey` and extends the range (React fires `onChange` even after `preventDefault`, so the shift test must be inside `onChange`). Tests: `lists/selection.test.tsx` (userEvent). Live: real mouse click then Escape clears. Real shift click not verified live (the agent-browser mouse commands carry no modifier).
- D2 log row: `RowHeader` wraps (`flex-wrap`), the chips holder is `ml-auto shrink-0 whitespace-nowrap` and drops under the title on a narrow pane, the summary keeps `min-w-[5rem]`, `TimeLabel` is `whitespace-nowrap shrink-0`. Checked at 390 (tool-call group, Bash row of a Background session).
- D3 grant item: text full width, actions in their own row below, Revoke is an icon button (the long label overflowed the rail). Checked at 1280 with the list open, with the confirmation open.
- D4 texts: Table intro no longer talks about hooks or SSE; Guardrails subtitle says the page only reads and where to add or revoke a bypass; one pair of constants (`commons/showLabels.ts`) for the filter, the Table YAML is pinned to it by `backend/views.test.ts`. Other texts checked (grep M1b, not built, pending, for now): `adoptSwitch.ts` "adoption (not built yet)" is still true.
- D5 header line: root cause `useChipFit` dropped chips from the END until the row stopped overflowing; the folder (196 px) is first and wider than the 87 px free at 1280 with the list open, so all 9 chips went into `+9` while a 39 px context chip would have fitted. Now `useItemFit` draws every chip once, measures each, and `fitItems` keeps the best-priority ones that fit next to the `+N` chip (priority `LINE_PRIORITY`: folder, context, what runs, model, role, program, tokens, duration, session id, pid; a chip that does not fit never blocks a narrower one). Re-measures when the width, the fonts (`document.fonts.ready`) or the content change. The `+N` tooltip lists `label value` and omits an entry without a value ("context 38% of the way to auto-compact"). `useChipFit` stays for `StatusInfo`. Measured at 1280 list open: name, state, age, context 3 %, +8 (was +9).
- D8 batch popup: with the list column on the left the centred pill started 13 px inside it (527 vs 540). The strip now starts at the right edge of the list column when the pill fits to the right of it (`clearListLeft`), else the whole content area. Measured 1280, 1440, 768, dock open and folded: popup left 677 / 757 / 271, list right 540 / 540 / none.
- D9 names: not `HerdrRowBody` but the default compact Tree row: its Move button was `opacity-0` but kept a 28 px slot (the bug of #95 in another row). It floats over the age on hover and focus now. `docs-writer` 50 px (cut) to 86 px (whole) at 1280 with sub-agents on. A name next to the host chip and the sub-agent count can still be cut.

## Herdr WAgents values and the Herdr-style pass (2026-11-25)

Source: `~/.config/herdr-app/mods/my-agents/main.js` (`row`, `status`, `header`, `focusGradient`, `ROW_LAYOUTS`, `DEFAULT_COLORS`). Reference screenshots: user's Herdr list. Values in px; colours are the mod's, ours are the theme tokens with the same alpha.

| Element | Herdr value | Used here |
|---|---|---|
| List padding | 8 | rows `mx-2`, headers `pl-4 pr-2.5` (8 + 8 and 8 + 2) |
| Row (standard) | height 30, px 8, radius 8, gap 9, text 13 | `HERDR_ROW_BOX` (30, `pl-2 pr-0.5`, `rounded-lg`), `gap-[9px]`, `text-[13px]` |
| Program icon | 16 | `h-4 w-4` |
| Name | white, semibold only when open; grey when idle and not unread; detail `· folder` dim, 13 | same; folder `text-muted-tint` (contrast) |
| Age | 11 dim | `text-[11px]` |
| Status column | none fixed: dot 7 + mx 3, spinner 12 + mx 1, "Needs you" chip in flow; header button 26 with icon 14, pr 2 | one 28 px column, icon centred (`ui/StatusColumn.tsx`); dot 7 (ring border 1.5), spinner 12, pill right aligned |
| Needs you chip | h 18, px 6, radius 5, bg red 15 %, text 10.5 semibold | same, `bg-hue-red-bg` |
| Tints | needs red `#e5484d` 20 %, flagged orange `#f0883e` 15 %, unread blue `#58a6ff` 12 % (first that applies wins) | `--am-herdr-needs-bg` 20 %, `bg-hue-orange-bg`, `--am-herdr-unseen-bg` 12 % |
| Open row | gradient of the accent, 16 slices from 30 % to 2 % (left to right), radius 8; optional bar (3 wide) and 1 px outline; fill 18 % | gold outline 1 px + gradient 30 % to 2 % (`--am-herdr-active-*`), the state tint stays under it |
| Group header | h 34 (8 above), pl 8, pr 2, gap 6, text 11 medium, title dim or state colour, count dim 11 after it, folder-cog button 26 radius 6 icon 14, folded: state + chevron 11 | `groupHeaderBox('herdr')`, name and count 11, cog in the 28 px column |
| Sub-agent row | h 26, text 12.5, pl 39 | unchanged (own component) |
| Font | Geist | Geist, default and only (below) |

Note: 11 px (age, group title and count) is under the 12 px floor of the density scale; the Herdr rows use fixed px on purpose (user request), the density table is untouched.

Changes and decisions:
- ui-tree-density: B (Herdr line) and C (tinted) differed only by the open-row gradient; merged into A Herdr (default, `herdr-tinted`). Options now: A Herdr, B Compact (previous), C Herdr name only. The Custom list always shows a Herdr row.
- ui-font settled on Geist: question removed, `data-font` removed, family set on `.agents-scope` with the fallback stack. The Geist Mono file is still embedded and served by `backend/fonts` (no longer used by the CSS; removing it needs a regenerated `fontFiles.generated.ts`).
- ui-group-header: the Custom list ignored the question (no visible change there). All lists now use `groupHeaderBox/Count/Name`: A Herdr (11 px grey, no background), B Bar (tinted bar, 14 px bold, count pill), C Pill (outlined name). Plain merged into A.
- ui-switch-readiness: root cause of "no difference": the default one-line header used an icon that ignored the question and always showed the badge. Now A grey icon with a green or amber dot plus the badge in the line; B a coloured pill with words (`Move: free`, `Move: N running`, `Move: unknown`), no badge; C grey icon plus a full-width coloured row under the header (`MoveBanner`).
- Gotcha: `npm run css` is not re-run by the dev server's watch; after adding a Tailwind class, run `tsx src/dsl-components/build/build-css.ts` or the class has no rule.

Screenshots (throwaway): `poc/results/ab-tree/`, script `poc/scripts/ab-tree-shoot.sh`.

## Decisions and base-component audit (2026-11-26, agent H)

Decided by the user: header actions = A (one line of icons), group header = A Herdr, tree rows = Herdr look A. The three questions left the dock; header actions code is deleted (ActionsMenu, AnchoredPopup, DetailsButton, StatusInfo, CwdBranch, useChipFit, MoveStatusLine). Group header and tree row branches still live in `lists/` and `ui/groupHeaderLook.tsx` (owned by the lists change): `UiVariantValues` keeps `treeDensity` and `groupHeader` as fixed defaults until those branches go.

Move readiness could not be tested on real data: the three looks only show for an agent started here, in the state it really has. The dock now has "Preview Move readiness" (real / free / busy / unknown): select any agent, pick a state; a discovered or ended agent gets a preview Move button that sends nothing (`logic/readinessPreview.ts`, `owned/ReadinessPreviewControls.tsx`). Without the dock the value is always `real`. Seen with agent-browser (isolated app-core 48811, 3 looks x 3 states, `poc/results/hmove/`). Left: look A busy has no room for the words badge at 1280 (the tinted icon and dot show it).

MoveToGroupDialog: input and button were 36 px vs 40 px forked markup. Now `FieldText` + `ButtonAction` in a `HorizontalStack` (wrap, items-end): both 40 px, same y, at 1280 and 390 (the button wraps under the input at 390). The error line is a separate alert under the row: `FieldText` would move the input up and break the alignment, and its `aria-invalid` cannot be set from outside.

Hand-made markup where a base component exists (not fixed here):

| Where | Markup | Base component | Verdict |
|---|---|---|---|
| `folders/FolderExplorer` root select | raw `select` | `CompactSelect` | no `max-w` control: long paths would widen it |
| `guardrails/DenialsSection` session prefix | raw `input` | `FieldText` | label-above layout of the base differs from the compact filter row |
| `workspace/SearchBox`, `NewGroupControl`, `folders/FolderTree`, `FolderSmartList`, `FolderPicker`, `FolderPalette` | raw `input` (icon, combobox, Escape) | none (`FieldText` has no leading icon, no combobox role) | keep |
| `detail/composer/ComposerBody` | raw `textarea` (auto-grow, drag and drop) | `FieldTextarea` | keep |
| `launch/NewSessionDialog` host choice | raw radio with icon and description | `RadioGroup` takes label strings only | keep |
| `ui/StyledCheckbox` | custom box | `Checkbox` has no indeterminate state | keep |
| `lists/InboxList` tabs | `role="tab"` buttons | `TabButton` | lists change |
| `detail/log/RailTabButton`, `SubagentModeSwitch`, `ui/DensityControl`, `workspace/ModeMenu` | segmented or toggle buttons | `TabButton` / `ChipButton` | to check one by one |
| text links that expand (`ReasonList`, `GuardrailBlocks`, `ThreadDialog`, `ToolOutput`, `PermissionInput`) | `button` with underline | `ButtonAction variant="link"` has no `aria-expanded` | keep |

## Selection mode, row menu, drag stability (2026-11-26, agent L)

- Sub-agent count chip removed from every row (Tree, Custom, Groups, Inbox); the chevron label keeps the count ("Show the N sub-agents").
- Row actions: one always visible `...` RowIconButton per row (after the age, before the 28 px status column; Groups and Inbox: beside the text block). Menu: move, flag, unread, pin, mark seen. Opened by click, right click, ContextMenu key, Shift+F10 (OptionShell handles the key itself). Group header buttons (pencil, folder-cog) no longer hidden until hover. Decision D2026-11-26a.
- Selection mode (`SelectionApi.mode`): checkboxes only in the mode, first item of every row and group header (same x), no space kept when off. Ctrl/Shift click, X and select all turn it on; Escape, the entry toggle, or clear leave it and clear the selection. Empty checkbox border is `muted-tint`: 6.0:1 on white, 7.0:1 on the dark surface (measured computed colors).
- Selection entry (settled 2026-11-27, the A/B question `ui-selection-entry` is removed): one icon toggle right after the "Agents" title; it never moves or changes meaning (second click leaves the mode and clears). Select all is a labelled button in a reserved slot to its right, so nothing shifts.
- Drag stability: the end-of-group strip keeps `h-1`; the drop zone is an absolute overlay mounted only during a drag; the Custom drop hint is absolute. Measured with agent-browser (real mouse drag, Custom and Tree): boxes of headers and rows identical before, during and after.
- Batch popup: strip from the menu edge to the window edge, pill centered, no list avoidance (D2026-11-26b). Measured center = content area center (760 at 1280 with menu, 640 menu hidden, 229.95 at 390).
- Not verifiable headless: Shift+F10 / ContextMenu key through the browser (covered by unit tests only).
- Screenshots (throwaway): `poc/results/sel/`.
