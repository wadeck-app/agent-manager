# Managing w-guardrails from the Agents module (v2 research)

Date 2026-11-21. Read-only study; nothing run beyond reading files. Marks: [D] doc, [C] code read, [M] measured/observed, [U] unknown.
`W` = `C:\Users\Wadeck\.claude\plugins\local-marketplace\plugins\w-guardrails` (v1.29.0, source repo `github.com/Wadeck/claude-w-plugins`, local clone `~\.claude\plugins\local-marketplace`). Installed copies also exist under `~\.claude\plugins\cache\local-marketplace\w-guardrails\{1.0.0,1.25.0,1.29.0}` [M]; which copy the hook runs from: [U].

**Correction to the premise:** there is no "base CLI" of w-guardrails [M]. `W` has no `bin/`, no `list`/`revoke`/`audit` command, and no `w-guardrails` executable on PATH. The only entry points are node scripts (section 3). Everything "CLI-like" below has to be requested from the plugin owner.

## 1. Data model

All state is per project, keyed by the hook's `event.cwd` (`pre-tool-use.js:166`, `projectDir = event?.cwd`), not by git root [C]. The kill switch and logs are global. A session that changes cwd mid-session uses another directory for the next call [C]; whether the registry `cwd` follows that: [U].

| Item | Path | Format | Writer | Reader (hook) | Protected? |
|---|---|---|---|---|---|
| Bypass grants | `<proj>\.claude\w-guardrails\guardrails.bypass.json` | `{overrides:[{id, category, decision:"allow", session_id, mode:"once"\|"ttl", expires(ISO), reason, max_uses?, used?}]}` [C `request-bypass.js:289-298`] [M] | `request-bypass.js` (after the `ask`), `bypass.js` (consume/purge), `reset-claims.js` | `loadBypass`/`findBypass` (`bypass.js:75,120`): needs same `session_id`, category, unexpired, <= 24 h ahead, `once` not used up | write: hardcoded deny `bypass-file-write` (`checks.js:1584`) for agent tool calls |
| Grant entry life | same file | entries are deleted on expiry (purge on read, `bypass.js:96-105`) and when a `once` is used up (`bypass.js:196-198`) | | | the file holds no history [C] |
| Pending tokens | `<proj>\.claude\w-guardrails\bypass-token-<nonce>.json[.claimed]` | `{nonce, category, mode, session_id, script_path, expires_at (1 h)}` [C `pre-tool-use.js:938-948`] | the hook only (step 1, rename to `.claimed` in step 2) | `request-bypass.js` | protected pattern `bypass-token-*.json` |
| Spam + block counters | `<proj>\.claude\w-guardrails\bypass-state.json` | `{requests:{<sessionId>:{refused_count,last_request_ts,timeout_until,block_counts:{<category>:n}}}}` [M: `interpreter-exec:37, rm:30, eval:6, kill:10` for this very session] | hook (`recordBlock`, `recordRequest`) | `checkSpam` | protected |
| Other state | `session-created-files.json` (own-file `rm` registry, 199 KB here), `advisory-state.json` (hashes only), `*.lock` | JSON | hook | hook | protected; irrelevant to the UI |
| Rules per project | `<proj>\.claude\guardrails.json`: `categories{name: deny\|ask\|allow\|advise}`, `category_messages`, `protected_files[]`, `secrets`, `bypass_hints` | JSON, project only, no global file [C `guardrails.js:9-17`] | the user (hand edit) | `loadConfig` | `guardrails-config-write`, hardcoded deny and non-bypassable (`checks.js:1890`) |
| Built-in defaults | `W\scripts\categories.js` (`CATEGORIES[name].defaultDecision`, patterns), `checks.js` (`CHECK_CATEGORIES`, hardcoded rules) | JS, not data | plugin release | hook | n/a; a module cannot read them without `require`-ing plugin internals |
| Malformed config | | | | `loadConfig` returns `null` and the hook silently uses built-in defaults [C] | A UI must warn: a typo in `guardrails.json` is invisible today |
| Blocked journal | `~\.claude\logs\w-guardrails\w-guardrails-blocked-<day>.jsonl` | one JSON per `deny`/`ask`: `{ts, session:"<8 chars>:M"\|"<8>:A:<4>:<agentType>", decision, trigger(=category), project, tool, command(<=500 chars), file}` [C `log.js:99-165`] | hook | none (analysis only) | not protected; readable [M] |
| Metrics journal | `...\w-guardrails-metrics-<day>.jsonl` | `{ts, session, category, decision, trigger("bypass","own-file","category","advised",...), project, command(<=200)}`; allow/ask/deny but only categories wired to `log.metric` (`rm`, `advise:*`) [C `pre-tool-use.js:597-610`] | hook | `metrics-report.js` | readable |
| Journal volume | | 61 blocked files = 234,963 records, 56 MB; 41 metrics files = 89,770 records, 21 MB [M, 2026-11-21]. Retention 90 days / 200 files [C `log.js:10-11,168-169`] | | | |
| Per-project text log | `<proj>\.claude\logs\w-guardrails\w-guardrails[-day].log` | `[ts] [<sid8>:M\|A:..] [LEVEL] msg`, lines cut at 180 chars, 30 days / 100 files [C `log.js:6-8,79`]. Bypass lifecycle lines: `[bypass:token-issued]`, `[bypass:request]` (the ask was shown; rationale cut), `[bypass:tentative]`, `[bypass:consumed]`, `[bypass:rollback]` [M] | hook | none | readable |
| Kill switch | `~\.claude\w-guardrails\DISABLED` (flag file, any content) | existence | the user only (`! touch`) | first thing in the hook | `kill-switch-write`, hardcoded |
| MCP read-only cache | `~\.claude\w-guardrails\mcp-tools-cache.json` | JSON | SessionStart hook | hook | n/a |
| Locking | grants: `request-bypass.js:320` locks `guardrails.bypass.json.lock`; `bypass.js:12` and consume use `guardrails.bypass.lock` (5 s stale rule); `reset-claims.js` and `reset-spam.js` take no lock | | | | **Two different lock names and two unlocked writers: no mutual exclusion between grant, consume and reset** [C]. Not a security issue, but a module writer would inherit it |

Gaps for a UI:
- No history of grants: after expiry or use, only the text log remains (`[bypass:request]` = a dialog was shown). The grant itself is not logged (`request-bypass.js` has no logger) [C].
- No refusal record: `recordRequest(..., 'refused'|'ignored')` is never called anywhere (grep: only `'pending'` and `'approved'`), so the "3 refusals -> 30 min timeout" rule cannot trigger from a refused dialog [C]. A user refusal is visible only as "token issued, no grant".
- `block_counts` counts only denies that carry a bypass hint (`pre-tool-use.js:626-691`), so it differs from the blocked journal (which counts every deny/ask, hardcoded ones included).
- Subagents share the parent `session_id` (`287760ca:A:a2a5:general-purpose` in the log [M]), so one bypass covers the subagents of that session.

## 2. The confirmation dialog

[C] It is Claude Code's own permission dialog for the step-2 Bash call, not a plugin UI.
1. Step 1: `node request-bypass.js --category C --mode M --session S --rationale R` is matched by the PreToolUse hook (`pre-tool-use.js:793`), which writes a nonce token and returns `deny` with the exact step-2 command (`:932-986`).
2. Step 2: same command plus `--token N`. The hook validates the token, renames it to `.claimed` and returns `permissionDecision: "ask"` with a 7-row text built by `buildBypassAskMessage` (`:1033-1042`, `ask-messages.js:62-77`: category, duration, 3 rows of the agent-written reason, session short id).
3. Claude Code shows "Do you want to proceed?" in the session's terminal. On approve it runs the Bash call: `request-bypass.js` validates the claimed token, its own script path and the arguments, then appends the grant (`request-bypass.js:249-346`). The script learns nothing about the approval; its header says "user approval of the ask IS the authorization" (`:6-10`).

Consequences:
- The approval channel is Claude Code's permission prompt. The hook holds no queue and has no PermissionRequest hook (`hooks/hooks.json`: SessionStart + PreToolUse `*` only) [C].
- `ask` becomes `deny` when `CLAUDE_SUBPROCESS_NONINTERACTIVE=1` or when the target is under `.claude/` (`pre-tool-use.js:176-188, 474-485`) [C]. No agent-manager code sets that variable [M grep]; the daemon must not set it on a session whose bypass dialogs the user wants to answer.
- Anything that runs `request-bypass.js --token` with a valid `.claimed` token gets a grant without any dialog. Tokens are produced only by the hook, so the dialog is the only gate [C].
- A web page can answer it only by pressing the terminal's key (`hc keys` for herdr-hosted sessions, `permission-prompt-remote-answer.md`, option 1) or, for X1 sessions launched by the daemon, through the structured `can_use_tool` request (Phase 3 permission card). Whether a PreToolUse `ask` surfaces as `can_use_tool` in stream-json: [U] (in `-p`, a PreToolUse `ask` was denied, `permission-prompt-remote-answer.md` Run 2 [M]). One interactive/stream-json run is needed.
- Design intent [D `threat-model.md`, "State-file forgery is raised, not eliminated"]: "The real boundary for the bypass file is the user approval dialog of `request-bypass.js`". Agent self-approval must stay impossible. Today an agent can already approve another session's dialog through `hc keys` (existing exposure noted in `permission-prompt-remote-answer.md`); whether w-guardrails blocks it: [U].

## 3. Plugin entry points today, and what a module may do

| Script (`W\scripts`) | Options | Effect | Gate | Module use |
|---|---|---|---|---|
| `request-bypass.js` | `--category --mode(once,5m,10m,15m,30m,1h,2h,4h,8h,24h) --session --rationale [--token] [--cwd]` | grants a bypass; `git-commit-push` grants two entries | hook: step 1 deny + token, step 2 `ask` | Never spawn it from the module: no hook, no dialog = grant without approval |
| `reset-claims.js` | `--session --cwd` | removes ALL grants of one session (no per-id revoke), no lock | hook `ask` (`checkResetRequest`, `:1050`) | Not callable as a user action without an equivalent confirmation; an agent running it still needs the dialog |
| `reset-spam.js` | `--session --cwd` | clears the refusal counter | hook `ask` | Same |
| `metrics-report.js` | `--category --days` | prints a table over the metrics journal | none | Text only, no `--json`. Read the journal directly instead |
| `build-mcp-cache.js`, `on-session-start.js` | internal | | | none |
| Kill switch | create or delete `~\.claude\w-guardrails\DISABLED` | disables all protection | file protected from agents | Never from the module (it turns every protection off) |
| Skills | `/w-guardrails:request-bypass <cat> <mode>`, `request-bypass-gcp4h` (hardcoded `git-commit-push` 4 h), `reset-claims`, `reset-spam` (`disable-model-invocation: true`) | the skill makes the agent run the same two-step flow; "user-initiated" is only a rationale string | same dialog | n/a |

Missing and needed (none exists): list grants, revoke one grant, list rules with effective decision per category, audit/history, pending-request feed, per-session block counts as an API, `--json` anywhere.

Proposed scope:

| Phase | Feature | Source | Safe? |
|---|---|---|---|
| R1 read | Active grants per session: category, mode, expiry countdown, uses left, reason | read `guardrails.bypass.json` of the projects of known sessions | Yes (read-only, plain file, filter `now <= expires`, show `once` used/max) |
| R1 | Blocked N times on [category], last blocked command (cut), per session and per project | blocked journal (session prefix + `trigger`) or `bypass-state.json.block_counts`; recommend the journal (complete, all projects, subagent aware) | Yes, but commands are sensitive (below) |
| R1 | Recent denials/asks timeline, filter by session/category | blocked journal tail (read the last day files, never the whole 56 MB) | Yes |
| R1 | Rules per project: effective decision per category | `guardrails.json` `categories` over defaults | Defaults are in JS: need the plugin to export them (request A2); until then show only overrides and say so |
| R1 | Spam/timeout state, malformed `guardrails.json` warning, kill switch ON banner | `bypass-state.json`, JSON parse, file existence | Yes. A malformed config and `DISABLED` must be loud |
| R2 action | Revoke a grant / all grants of a session | none safe today | Needs plugin API (request A3). Direct edit of the file by the module is a write to a protected state file (section 4) |
| R2 | Create a time-boxed bypass from the UI | none | Needs plugin API with a user-presence design (request A4), PIN-gated route |
| R3 action | Edit allowlists / deny rules (`guardrails.json`) | file is protected from agents; the user may edit it | Highest risk: a module route that rewrites security config = a path for an agent that passes the PIN gate. Prefer "open in editor" or a diff-and-confirm flow. Not before R2 is stable |

## 4. Security analysis (web page on loopback)

Threats [C, `threat-model.md`, module `threat-model.md` T-01/T-08/T-12]:

| # | Threat | Today | Verdict |
|---|---|---|---|
| G-1 | An agent with Bash calls `curl` on a module GET route to read grants, denials, commands | GET routes have no auth (only non-GET have CSRF + PIN). No w-guardrails rule blocks loopback curl (grep `127.0.0.1`/`4850` in `checks.js`, `categories.js`, `pre-tool-use.js`: no match [C]; D-B still pending) | Read leaks session ids, project paths, rationale, and the first 500 chars of every blocked command of every project (these can hold tokens that guardrails does not know as secrets: it redacts only the configured secret values, `pre-tool-use.js:227-229`). Put the command text behind the PIN (sensitive GET) or cut it to a short preview; keep counts, categories and expiries open |
| G-2 | Agent curls a module "create bypass" route and self-grants | Same path as T-08. CSRF is forgeable by a same-user agent; the PIN gate (T-01) stops it unless the agent has a PIN token or brute-forces `auth.json` (6 digits, residual in T-01) | Acceptable only if the route is `sensitive` (PIN) AND the PIN is never cached for this class (re-prompt per grant), AND the audit shows it. Still weaker than a terminal dialog that needs the physical user, so default to the shortest TTL (`once`, 5 m) and a category allowlist |
| G-3 | The module writes `guardrails.bypass.json` itself | Technically possible: the hook only screens agent tool calls, not the module process | Forbidden. It changes the plugin invariant "state files are written only by `request-bypass.js` after the user approved" and bypasses every regression test of the plugin. Only a plugin-provided entry point may write |
| G-4 | Module route accepts a project path from the client | Read or write of an arbitrary `<dir>\.claude\w-guardrails` | Never accept paths. Derive the project from a session id the server resolves through the registry (and the journal's `project` for history) |
| G-5 | Agent edits rules through the UI (R3) | `guardrails.json` is hardcoded-deny for agents so that an agent cannot loosen its own rules | A module route that edits it re-opens exactly that hole. Read-only first; if ever, PIN + diff + never a category that is `NON_BYPASSABLE` |
| G-6 | Approving the ask from the web (permission card) hides which bypass is being approved | The card (Phase 3) answers any `can_use_tool` | For a bypass step-2 call the card must show the category, mode, reason and session, and must not offer "always allow". Requires R-U1 below. Default: do not offer web approval of bypass dialogs (T-08 in `permission-prompt-remote-answer.md`), opt-in later |
| G-7 | Stale or forged reads | An agent cannot write the files, but the module trusts JSON | Treat as untrusted: validate shapes, escape strings, cap sizes (the plugin itself ignores > 64 KB, `bypass.js:6`) |

What the agent-manager daemon must not do:
- write, move or delete any file in `.claude\w-guardrails\` or `guardrails.json`;
- spawn `request-bypass.js`, `reset-*.js` or touch `DISABLED`;
- press keys (`hc keys`) or answer `can_use_tool` for a prompt whose tool call is a `request-bypass.js` step 2, unless the user opted in;
- set `CLAUDE_SUBPROCESS_NONINTERACTIVE=1` on owned sessions (it turns every `ask` into a `deny`, so all bypass dialogs would fail);
- create a bypass because a session event says it was blocked (the trigger must be a human click);
- hold a copy of grants (always re-read the file: the hook's view is the truth).

Safe read-only: grants without reason text, expiry, categories, counts per category, session names, spam timeout, kill-switch state, rules overrides.

## 5. Integration with agent-manager

| Need | Fact | Plan |
|---|---|---|
| Join a journal row to a session | journal `session` = first 8 chars of the id + `:M` or `:A:<agent4>:<type>`; the registry gives the full UUID [C][M] | match on prefix (8 hex = ok for one machine); show subagent rows under their parent |
| "Blocked by guardrail" badge on a row | journal rows with `decision` deny/ask in the last minutes for that prefix, plus the session being idle/blocked; the `ask` of a bypass has `trigger: "bypass-request"` | derive from the journal tail; badge text "blocked 37x on interpreter-exec" from `bypass-state.json` or journal counts |
| Which category is blocking right now | the last deny's `trigger` | show it with the command preview (PIN-gated command) |
| One click "bypass for this session" | no plugin API | needs request A4; until then the row shows the exact text to run `/w-guardrails:request-bypass <category> <mode>` in that session (copy button), and says why (visible, not a silent no-op) |
| Relation to the permission card (Phase 3) | The card answers the Claude Code permission prompt of X1 sessions. A guardrails `ask` is a PreToolUse `ask`: whether it arrives as `can_use_tool` is [U]. The step-1 `deny` needs no card (the agent retries on its own) | run one stream-json test (needs model calls: ask the user first); until proven, the card must treat a bypass step-2 as "answer in the terminal" |
| Does the journal carry what the UI needs | yes: session, category, project, tool, command(500), file, ts. Missing: full session id, tool_use_id, the agent-written rationale of a pending request (only in the project text log, cut at 180 chars), grant ids, refusals | request A5 (pending feed) |
| Format/retention risk | a 56 MB / 235 k-record store: tail by day file, index only the last N days, never parse all files per request; the format is not versioned | owner must promise the schema (request A1) |

Pending requests: between step 1 and the dialog there is a `bypass-token-<nonce>.json` with category, mode, session and expiry (1 h) [C]; after step 2 it is renamed `.claimed`. The module can list "requests waiting for the user" by reading these files read-only. The rationale is not in the token, only in the log line [C].

## 6. Ownership and requests to the plugin owner

| Part | Owner |
|---|---|
| Hook, categories, grants, file formats, logs, skills, README/threat model | plugin owner (repo `claude-w-plugins`; its CLAUDE.md: peer requests are implemented with TDD if they make sense, never grant approval) |
| Reading plain files, views, join with sessions, PIN-gated routes, audit of UI actions, rows and badges | this repo |

Requests (cross-session message to the plugin owner agent; none sent by me):

| # | Request | Why | Needed for |
|---|---|---|---|
| A1 | Document and version the on-disk schemas: grants file, bypass-state, blocked/metrics journals (`schema` field), retention | Avoids parsing drift | R1 |
| A2 | `node scripts/guardrails-cli.js rules --cwd <dir> --json`: effective decision per category (defaults + overrides), hardcoded and non-bypassable flags, config parse error text | Defaults live in JS only; a malformed config is silent today | R1 rules view |
| A3 | `bypass list --json` (all projects or `--cwd`) and `bypass revoke --id <id> --cwd <dir>` that takes the same lock as the hook and refuses to run from an agent (hook `ask`, like `reset-claims`) | Per-id revoke does not exist; `reset-claims` removes the whole session | R2 revoke |
| A4 | `bypass grant-from-ui --category --mode --session --cwd --reason` guarded by a one-time capability the user creates out of band (for example a signed request file written by a PIN-gated module route and consumed once), logged as `granted` with origin `ui` | The only way to grant without the terminal dialog and without the module writing the protected file | R2 create |
| A5 | Log the outcome: `granted`, `refused`/`ignored` (the missing `recordRequest` calls), `revoked`, with grant id and full session id; keep the rationale (200 chars) in the journal | No history today; spam rule inert | audit view |
| A6 | Fix the two lock names (`guardrails.bypass.lock` vs `guardrails.bypass.json.lock`) and lock `reset-*.js` | Lost-update race between grant, consume, reset | any writer |
| A7 | Optional: a `PermissionRequest`-free "pending" file or event for step 2 (category, mode, reason, session) | Lets the UI show what the dialog asks | permission card |
| A8 | Optional: a rule denying loopback calls to app-core module routes (D-B) | Closes G-1 for agents using curl (not node `http`) | G-1, G-2 |

If the owner refuses:
- A1, A5, A6: read-only module still works on the current formats, with a version check (fail loudly on unknown shape) and no grant/refusal history.
- A2: show overrides only and state "defaults not shown".
- A3, A4: no UI action; the UI offers "copy this command" for the user to run in the session (`/w-guardrails:request-bypass`), revoke stays `reset-claims` in the terminal. This is the secure fallback.
- Never fall back to the module writing the file.

## 7. Options

| Option | What | Pros | Cons | Security verdict |
|---|---|---|---|---|
| A. Read-only module | Parse grants, bypass-state, tokens and journals; join to sessions; badges, timeline, rules overrides; copy-the-command helper | No plugin change, no new privilege, fast to ship, gives the "blocked 28 times" view | Format drift risk, no actions, defaults not shown, no grant history | Safe if the command text is PIN-gated or cut (G-1) and paths never come from the client (G-4) |
| B. Module + CLI wrapper | Module spawns plugin scripts (`request-bypass.js`, `reset-claims.js`) | None needed from the owner | Scripts depend on the hook for their gate: spawned from the module there is no hook, so no dialog; `reset-claims` has no per-id revoke; text output only | Rejected: converts the plugin from "human click" to "any local caller", forbidden by G-3 |
| C. Module + plugin API | Owner ships A1-A6; module calls `rules/bypass list/revoke/grant-from-ui` behind PIN | Real actions, one writer, one lock, history, stable contracts | Cross-repo work and a threat-model pass; the grant action weakens "physical user at the terminal" to "PIN at the browser" (G-2) | Acceptable for revoke (it only reduces privilege). Grant only with A4 design, short TTL, PIN per grant, category allowlist, and a visible user decision |

## Recommendation

1. Ship option A as the v2 first slice, now: Guardrails tab (or panel on the session row) with grants + expiry, blocked counts per session/category, denial timeline, spam/timeout, kill-switch and malformed-config warnings. Read the journal tail by day files; commands behind the PIN.
2. Send A1, A2, A3, A5, A6 to the plugin owner immediately; do revoke (option C) once A3 exists, since revoke only lowers privilege.
3. Do not build a UI "grant" until the user decides on A4 and the web-approval question (open questions 1 and 2). Until then the session row offers "copy command" for `/w-guardrails:request-bypass <category> <mode>`.
4. Never write the plugin's state files from the module or the daemon, and never answer a bypass dialog from the web by default.

## Open questions for the user

1. Is "grant a bypass from the browser after a PIN" acceptable at all, given that the plugin's design says the terminal dialog is the boundary (G-2)? If yes: max TTL and category allowlist (for example never `rm` beyond `once`)?
2. For an owned (X1) session, may the permission card approve a bypass step-2 dialog, or must those stay terminal-only (T-08)? An experiment (stream-json, a few model calls) is needed to learn whether the `ask` arrives as `can_use_tool` ([U]); do you approve it?
3. Show blocked command text in the UI: PIN-gated, short preview open, or never? (G-1: commands may hold secrets unknown to guardrails.)
4. Do you want a plugin rule denying loopback curl to the module (D-B/A8) before any action route exists?
5. Which projects to scan: only cwds of live registry sessions, plus the journal's `project` values for history? (State is per cwd, and a session may change cwd, [U].)
6. May I send A1-A8 to the plugin owner agent (it needs your go-ahead; I sent nothing)?
7. Should R3 (editing `guardrails.json`) be dropped from the roadmap, since a UI editor reopens the "agent loosens its own rules" hole the plugin closed on purpose?

## Implementation (phase 1, read-only, 2026-11-21)

Page `/guardrails` (nav "Guardrails", sibling path of `/agents` and `/table`, no prefix collision). Module code only reads the plugin files: no change, no spawn, no `request-bypass.js`.

| Piece | Where |
|---|---|
| Names of the plugin files (one place) | `backend/guardrailsNames.ts` |
| Versioned readers (shape v1 = plugin 1.29.0): grants, counters, rules, kill switch | `backend/guardrailsFiles.ts` |
| Journal tail reader (backward chunks of 64 KB, byte budget) | `backend/guardrailsJournal.ts` |
| Routes, folder discovery, row chip data | `backend/guardrailsRoutes.ts` |
| Contract types | `commons/guardrails.ts` |
| UI | `dsl-components/guardrails/`, registered component `components/GuardrailsPage.tsx`, view `dsl-views/guardrails-page.yaml` |

Routes (GET only): `/guardrails/overview` (open), `/guardrails/denials` (open, no command text), `/guardrails/denials/commands` (PIN, `sensitive`). Threat model T-13.

Decisions:
- Folders scanned: cwds of the session registry (alive or ended), cwds of daemon sessions, `project` of the newest 512 KB of the journal. The page lists the sources, every folder and every unreadable file. Max 150 folders. Non-local paths (UNC, relative) are refused.
- Unknown shape = problem (file, what, what to do) and nothing shown from that entry or file; unknown field, bad type and unknown journal lines included. A rules file with an unknown key is shown with a warning; a wrong container type is `malformed`.
- Grants the hook ignores (expired, used up, more than 24 h ahead) are counted, not listed.
- Effective rules are not shown: defaults live in plugin JS (A2 pending). The page says so and shows the file as written.
- Chip on rows and detail: `guardrailBlocks` in `GET /sessions`, matched on the 8-character prefix (full id first), from the counters file of the row's own cwd (cached by mtime and size). The copy button gives `/w-guardrails:request-bypass <category> once`; the module grants nothing. An unreadable counters file shows a banner on the Agents page (`guardrailsErrorText`).
- The counters count only denials with a bypass hint; the timeline counts every deny and ask.

Not done: revoke, grant from the browser, editing `guardrails.json` (need A3/A4 or a diff-and-confirm design), grant history, pending-request feed.
