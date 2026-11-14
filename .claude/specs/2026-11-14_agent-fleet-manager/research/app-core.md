# app-core -- app-module system and A/B facility

Date: 2026-11-14. Gathered by an Explore sub-agent reading `C:\Workspace_Tooling\app-core`.
Status: `agent report`; the lead re-read none of it. Paths are under `C:\Workspace_Tooling\app-core` unless noted.

## Conclusion

app-core is a loopback-only Fastify host (React 19 + Vite 6 shell) that loads daemon-shipped modules at runtime. Module views are declarative YAML; custom React only through `dslLib`. There is no push channel to the UI: polling or SSE only, no WebSocket API for modules. The A/B dock is built in and ships variants to production. No authentication.

## What it is

| Item | Fact |
|---|---|
| Host | Node process on `127.0.0.1` (`README.md:3`, `packages/server/src/start.ts:16`) |
| Packages | `server` (Fastify), `frontend-shell` (React), `app-core-sdk`, `app-core-cli`, `test-app-modules` (`README.md:5-13`) |
| Frontend stack | React 19, Vite 6, Tailwind 3, react-router-dom 7, `@wadeck-app/dsl-ui`, `@wadeck-app/dsl-renderer` (`packages/frontend-shell/package.json`) |
| Views | YAML/JSON DSL; React allowed only in optional `src/dsl-components` |

## Module contract (`packages/app-core-sdk/docs/module-authoring.md`, `registering-a-module.md`)

| Aspect | Fact |
|---|---|
| Layout (`:37-48`) | folder `app-module-<name>`: `manifest.json`, `package.json` (`"files":["dist-module"]`), `.gitignore`, `src/backend/index.ts`, `src/dsl-views/*.yaml`, `src/dsl-components/` (optional), `src/commons/`; `app-core-cli check` enforces layout (`:50-61`) |
| Backend entry (`:222-257`) | default export `(ctx: ModuleContext) => void` (`packages/server/src/moduleContext.ts:17`); `ctx`: `dataDir`, `registerRoute(method, subPath, handler)`, `fileVersion`/`unchanged` (ETag/304), scoped `setInterval`/`setTimeout`, `on`/`off`/`emit`; everything registered through `ctx` is cleared on unload |
| Manifest (`:117-153`) | `id` (`^[A-Za-z0-9][A-Za-z0-9_-]*$`), `title`, `showInNav`, `requires`, `optionalRequires`, `expose`, `lifecycle`, `dslLib.shared`; extension points with `kind` (`widget`/`page`), `slot` (`dashboard`, `nav`, `route`, `navbar`, `overlay`, `<provider>:<slot>`), `path`, `label`, `order`, `width`, `height`, `tab`, `count`, `separatorBefore`, `groupLabel`; source manifest strict, `version` and `backendEntryPath` stamped by `package` (`:93-107`) |
| Hooks (`:287-326`) | `migrate(ctx)` and `teardown(ctx)` each in their own file; persistent data in `ctx.dataDir` (never deleted by app-core); 30 s timeout per step (`APP_CORE_HOOK_TIMEOUT_MS`); no rollback after teardown |
| Discovery/loading (`:155-185`) | daemon calls `POST /api/modules/register` `{id, source:{type:"file", path:<dist-module/manifest.json>}}`; `POST /api/modules/update` pushes a version live; `POST /api/modules/unregister`; if app-core is down, registration writes `<config dir>/modules/<id>.json`, picked up at next start; load order follows `requires`; cascade/recovery rules `:557-570`; failures listed under `failed` in `GET /api/modules` |
| Daemon-side SDK | `registerModule({id, manifestPath})` from `@wadeck-app/app-core-sdk/register` (`registering-a-module.md:6-14`); outcomes `registered`, `unconfirmed`, `refused`, `deferred`, `skipped`; port from `APP_CORE_PORT`, then `server.port.json`, then 4850 |

## Pushing data to a module and to the UI

| Path | Fact |
|---|---|
| Daemon -> module backend | (1) module backend proxies to the daemon over its IPC client (queue pattern: `queue/packages/app-module-queue/src/backend/client.ts:1-6`, `push.ts:5-14`); (2) call module routes directly `POST http://127.0.0.1:4850/api/modules/<id>/<subpath>` (CLIs/curl accepted; guard only refuses browser cross-site, `requestGuard.ts:51-69`, `module-authoring.md:762`); (3) write files into `ctx.dataDir` and serve with `ctx.fileVersion`/`ctx.unchanged`; (4) `ctx.emit`/`ctx.on` in-module (whether they cross modules: UNVERIFIED) |
| Backend -> UI | REST via `$sources`/`$actions` in YAML (e.g. `url: GET /api/modules/my-module/history`, `poll: 30s`, `:328-345`); actions like `POST /api/modules/queue/jobs/{id}/replay` with automatic toasts (`:397-407`); **SSE supported** via `reply.hijack()` and `text/event-stream`, ended on unload/swap, `EventSource` reconnects (`:261-269`); **no WebSocket API for modules**; shell polls `GET /api/modules` with backoff; spec decision 25 "No SSE/WebSocket push" (`.claude/specs/2026-10-10_modular-plugin-platform/_index.md:135`); CSP `connect-src 'self'` would allow a same-origin WebSocket (`packages/server/src/csp.ts:43-44`); whether Fastify has a WebSocket plugin: UNVERIFIED |
| Custom components | `dslLib` React bundles loaded at runtime, using shell singletons from `globalThis.__APP_CORE_SHARED__` (react, react-dom, react-router-dom, dsl-ui, dsl-renderer) (`:620-624`); indicators, tabs, breadcrumb available (`:376-541`) |

## Auth, storage, theming

| Item | Fact |
|---|---|
| Auth | none; loopback only, trusted-local (`threat-model.md:58`, T-03); guard refuses non-GET with `Sec-Fetch-Site` `cross-site` or `same-site` (403 `cross-site-request`) and any request with non-loopback `Host` (403 `host-not-allowed`, override `APP_CORE_ALLOWED_HOSTS`) |
| Storage | per-module `ctx.dataDir` = `<config dir>/data/<id>/`; state file `<config dir>/state/<id>.json`; registry `<config dir>/modules/`; config dir = `APP_CORE_CONFIG_DIR` else `~/.config/app-core`; browser data in localStorage |
| Theming | light and dark; use dsl-ui semantic tokens, not raw colours; `ThemeScope` for fixed-palette subtrees (`packages/app-core-sdk/README.md:29-42`); theme set before first paint by `public/theme-init.js` |
| Dates | never format yourself: `format: datetime`, `DateText`, `useDateFormat()` (`module-authoring.md:543-555`) |

## A/B testing facility (`@wadeck-app/dsl-ui`, rules in `CLAUDE.md:3-10`)

| Aspect | Fact |
|---|---|
| In code | `useAbTest({id, label, initial, options:{key:{label, hint}}})` returns `{...test, value}` (`useAbTest.ts:17-37`); apply `tab.value`, render `<AbDock tests={[tab]} />`; in the shell `useDockTests(tests)` (`packages/frontend-shell/src/useDockTests.ts`) joins the single dock; each option's `hint` is its tooltip |
| In a view (YAML, preferred for modules) | `$type: AbTest`, `id`, `label`, `initial`, `variants: {key: {label, hint, view: {...}}}`; variants may nest other `AbTest` nodes |
| Dock | bottom-centre bar, one row per test; can fold into an "A/B (N)" pill (`ab.collapsed`); rows hideable (`ab.hidden`, choice stays applied); "Copy report" button; hides when no tests |
| Persistence | localStorage `ab.<id>`; forced by link `?ab.<id>=<option>`; follows other tabs; shell records sightings under `app-core.ab-tests-seen` |
| Gating | `isDev()` true only when `process.env.NODE_ENV === 'development'`, fails closed (`isDev.ts`); `<AbExperiments enabled>` mounted once in `packages/frontend-shell/src/App.tsx:73` as `enabled={abTests ? true : undefined}` from `GET /api/shell-settings` (`server.ts:146`); staging/packaged builds opt in with `app-core-cli serve --ab-tests` (`cli.ts:174,237`) or `app-core-cli dev <module> --ab-tests` (`module-authoring.md:201`); disabled -> every `AbTest` renders its `initial` variant and never reads storage or URL; to see the dock in app-core itself run `npm run dev` in `packages/frontend-shell` (Vite 5173; `APP_CORE_API=<url>` repoints the proxy, `CLAUDE.md:7`) |
| Inventory | `GET /api/ab-tests` and the shell A/B tests page list all modules' tests; views counted exactly, `useAbTest` in `dslLib` bundles estimated from bundle text (`module-authoring.md:366-374`) |
| Rules (`CLAUDE.md`) | wire every variant into the real page, never only a demo route; click through every variant with agent-browser and check the console before reporting ready; once decided, bake in the winner and delete losers and the `AbDock`; no shell test currently open |
| Limit | variants ship to production: nothing confidential in them (`AbTest.d.ts`) |

## Limits and refusals

- CSP: no inline `style` or script, no external origins, no `data:`/`blob:` images (`:652-661`).
- Raw timers forbidden in the backend; `commons` may not import Node builtins.
- `registerRoute` refuses duplicate route shapes and the `/_lib` prefix; `<own id>:nav` and `expose.slots.nav` reserved.
- Only `file` sources supported (npm gives 422); another module's slot needs `requires`; a `dslLib.shared` version mismatch is refused with 422 `shared-version-mismatch`.
- A `.mjs` backend leaks one copy per update (`:169`); `check` does not type-check.
- Bad A/B declaration shows an alert node; duplicate id with a different test refused; without a host in dev the stored choice applies but cannot be changed.

## Example modules

| Module | Where | Note |
|---|---|---|
| Queue | `queue\packages\app-module-queue\` | `manifest.json` (dashboard widgets, navbar widget, `expose.slots.project-header`), `src/backend/index.ts`, `src/dsl-views/*.yaml`; read by the sibling agent |
| Daemon registration | `queue\packages\queue-cli\src\daemon\AppCoreRegistration.ts:1-25` | `registerModule`, best-effort, never throws |
| Reference to copy | `packages/test-app-modules/app-module-example` | referenced in docs; directory not read |
| Other users | `orchestrator/app-module-orchestrator`, `task/app-module-task`, `scrapers/app-module-health`, `machine/app-module-machine`, `_test-factory*/app-module-school`; `agent-fleet/packages/app-module-flow` (see `agent-fleet-reuse.md`) | package.json only |

## Unverified

`app-core-cli init`, contents of `test-app-modules`, whether `ctx.emit` crosses modules, whether any module uses a WebSocket, dsl-ui AbDock internals beyond the `.d.ts` and the files above.
