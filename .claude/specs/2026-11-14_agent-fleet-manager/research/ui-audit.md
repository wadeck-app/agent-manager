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

| Question (dock id) | Options | Recommendation and reason |
|---|---|---|
| Header actions (`ui-header-actions`) | inline icons / More menu / split Fork | **Inline.** Three small icons with tooltips; width was never the problem (the height was, fixed for all). Menu is better on a phone, costs a click for Fork. |
| Tree rows (`ui-tree-density`) | comfortable / compact / card | **Comfortable.** The name is never cut by a chip. Compact fits more agents but hides host words and truncates names again. Card costs vertical space. |
| Status chips (`ui-chip-style`) | soft / outline / dot | **Soft.** Strongest signal for "needs you". Dot is the calmest and the weakest for urgent states. |
| Move readiness (`ui-switch-readiness`) | badge / amber button / banner | **Badge.** Short label, the count is visible, colour is never the only signal (full words stay in the accessible name). Banner is clearest but tall. |
| Thread action (`ui-thread-placement`) | on hover / always / labelled on hover | **On hover** (always visible on touch and on focus). Quiet log; the action stays in the DOM and focusable. Always is more discoverable. |
| Group header (`ui-group-header`) | bar / plain / pill | **Bar.** Groups read differently from workspace folders. Pill is tiring with many groups. |

Limits: the thread hover state was verified by computed opacity (0 then 1), not by a visual diff. The group header was shot with two uncolored groups (the color edge is untested visually).

## Side effects worth a look

- `RowMarks` is shared by Groups and Inbox: only the wrapping fix applies there; the density/icon-only variants apply to the Tree only.
- `docs/` or user notes that mention "(X1)" in the launch dialog no longer match.
