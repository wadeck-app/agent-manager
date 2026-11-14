# Sibling CLIs -- queue, task, project

Date: 2026-11-14. Gathered by an Explore sub-agent reading `C:\Workspace_Tooling\{queue,task,project}` and shared libs.
Status: `agent report` throughout unless marked `[V]`. The agent noted it read the cited files directly; the lead re-read none of them. Paths are under `C:\Workspace_Tooling`.

## Conclusion

Follow the "family A" layout: private workspace, CI-published `@wadeck-app/<name>-cli`, esbuild CJS bundle, CalVer, shared libs `shared-cli`, `shared-updater`, `singleton-daemon-kit`. A daemon (queue-style) fits a hook-fed tool; task and project have no daemon. None of the three integrates with Claude Code hooks directly, so the hook -> CLI -> daemon path is new work.

## Shared substrate

| Item | Fact |
|---|---|
| Libraries | `shared-cli`, `shared-updater`, `singleton-daemon-kit` |
| Best-practice doc | `shared-cli/docs/cli-best-practices.md`: exe-in-npm layout, config dir `~/.config/<app>`, CalVer, esbuild CJS bundles, mandatory `cli self-check`, Windows detached spawning. Sections 1.1 and 3 name queue, task, flow as "family A". **Partly stale**: sections 2-8 still say `@wadeck/` and GitLab |
| Stack | TypeScript 7, Node >= 22, npm workspaces, vitest 4 with `--bail=1` (queue `package.json`) |
| Update | commit + push -> CI publishes to GitHub Packages -> `queue cli update`; updater in `without-daemon` mode spawned as `queue-updater.cjs`; only CalVer (`YYYY.MM.DD-BBB-sha`) versions may update the global install, a dev build exits 1; interrupted install leaves `update-state.json` at `applying` and the next run repairs |

## queue

| Aspect | Fact |
|---|---|
| Packages | `queue-sdk`, `queue-core`, `queue-cli`, `queue-relay-client`, `plugin-github`, `plugin-gitlab`, `plugin-agent-wake`, `app-module-queue`; `queue-core` imports protocol constants from `queue-sdk/protocol`, never the reverse (`CLAUDE.md:5`) |
| Commands | hand-written dispatcher `queue-cli/src/cli/QueueIndex.ts` (1553 lines); one file per feature with a `.test.ts`; exit codes in `exitCodes.ts`; unknown option exits 4 with a "did you mean" hint |
| Daemon | `queue-cli/src/daemon/QueueDaemon.ts` on `createDaemon` from `singleton-daemon-kit`; singleton, spawned detached by `spawnDetachedProcess`; idle shutdown after 60 s with no pending work (`IdleShutdown.ts`); `onStart`/`onShutdown` re-register the app-core module each start |
| Transport (read in `singleton-daemon-kit/src/health-server.ts`) | HTTP on `127.0.0.1` only: `GET /version` (no auth), `GET /health` (auth), `POST /quit` (auth), `POST /<command>` (JSON body, `{ok, result}`); bearer token in `<configDir>/health_token`, random per start, mode 0600; port in `<configDir>/config.port` as `{sdkVersion, port, pid, startedAt}` with a 30 s heartbeat; tries base port + up to 10; default 47910, override `QUEUE_DAEMON_PORT` (1024-65535, invalid throws); tests use port 0; clients check `/version` pid and `config_dir` before sending the token |
| State | `~/.config/queue` (or `--config`, `QUEUE_CONFIG_DIR`, `XDG_CONFIG_HOME`): `wal.ndjson`, `dlq.ndjson`, `history/<day>.ndjson` (91 days, 200 MB), `logs/<day>.ndjson`, `subscribers.yml`, `waiters/waiter-<name>.json`; locked rewrites via `FileLock` |
| Events | `queue-sdk` `createQueuePublisher`: zero dependencies, never throws, starts the daemon with `queue start`, SemVer'd push protocol (`docs/push-protocol.md`, 1.7.0) |
| `queue wait` | blocks on history; patterns `*` (one segment) and `>` (rest); `--name <who>.<what>` registers the wait with a 15 s heartbeat and a wake pipe/socket; exit 0 matched, 2 timeout, 4 usage (`docs/wait.md`) |
| Hook link | `plugin-agent-wake` emits `agent.message` to a Claude session id or `project:<folder>` |
| Extension seams | subscriber types `cli`, `http`, `action` (`dispatch/*Transport.ts`); `ActionPlugin` + registry (`queue-core/src/actions/`: `validate`, `run(ctx)`, `push` limited by hop cap 5 and 100 emissions per chain), built-ins registered in `queue-cli/src/actions/builtinActions.ts` at daemon start (new plugin needs a restart); `RelayPlugin` for event sources; `before.*` events run synchronously and can abort, others go through WAL + DLQ; package barrels are the public API |
| app-core | `app-module-queue`: `manifest.json` (id `queue`, widgets, nav pages, slot `queue:project-header`); backend `src/backend/index.ts` `(ctx: ModuleContext)` with `ctx.registerRoute` -> `/api/modules/queue/*`; reads queue files directly via `queue-core`, calls the daemon only for push/replay/retry; `npm run check` and `bundle` -> `dist-bundle/app-module/`; daemon registers via `registerModule` from `app-core-sdk/register` (`AppCoreRegistration.ts`, best-effort, never throws) |
| Docs read | `CLAUDE.md`, `product-vision.md`, `out-of-scope.md`, `guiding-principles.md` (headings), `threat-model.md` (head), `docs/wait.md`, `push-protocol.md` (head), `project-integration.md`; `lessons-learned.md` (172 KB) skimmed at most |

## task

| Aspect | Fact |
|---|---|
| Packages | `task-core` (`TaskBackend` port, `LocalFileBackend`), `task-service` (pure use cases, no console/exit), `task-cli`, `app-module-task`, `dsl-lib-task`; dependency direction enforced by `architecture/rules.ts` in `npm test`; eslint no-floating-promises, prettier, temp-dir sweeper |
| Install | same pipeline; `UPDATER_MANUAL=1 task cli update`, then `task -v` (`CLAUDE.md:11`); platforms win32-x64, darwin-arm64, linux-x64; bin shim runs `node task.cjs` except `start` (Go launcher); tests spawn bundles only via `spawnIsolated` |
| Commands | `TaskIndex.ts` + `commands/*Command.ts`; every command takes `--json` (`{error, hint}` on failure); `-p/--project` read by the project SDK; `--follow` is snapshot diffing (`guiding-principles.md`) |
| Daemon | none; only `task serve`, a foreground `node:http` server for ONE project: loopback by default, `--allow-lan` otherwise, token from `TASK_SERVE_TOKEN` (16+ chars), protocols 1 and 2 via `X-Task-Protocol`, write queue as single writer |
| State | `<registry>/projects/<id>/task/{data,config}`; `<data>/tasks/<id>.json`, `task-index.json`, atomic writes via the project SDK |
| Events | after each saved write, events published through `queue-sdk` (`publishAndWait`); names `onTaskCreated`, `onStatusChange`, ... (table at `CLAUDE.md:509`); delivery failure never fails the command |
| Plugin seams (`CLAUDE.md:59-70`) | generic host `task-service/src/plugin-host/`: `Plugin {extensionPoint, validate, create, describe}`, `createPluginRegistry`, `resolveSlot`, 30 s `createInstance`; kinds `strategy` (local, github, gitlab, remote), `transport`, `ordering`; built-ins listed in `plugins/builtinPlugins.ts`; no external plugins, no `import()` (rule `NO_COMPUTED_IMPORT`); shared contract suite `runBackendContract` |
| app-core | `app-module-task` ships routes and pages; `task cli register` stages the module copy in `<config>/app-module/<ver>/`; no daemon so registration only on `register` and `update`; fills `task:project-header` and `/related/project/:id` |
| Docs read | `CLAUDE.md` (selectively, 248 KB), `product-vision.md`, `out-of-scope.md` (grep), `guiding-principles.md`; not read: `threat-model*.md`, `lessons-*` |

## project

| Aspect | Fact |
|---|---|
| Docs | no `CLAUDE.md`, no vision docs; only `.claude/session/*.md` and a spec folder (not read in full); docs in `packages/*/README.md` |
| Layout | `project-sdk` (zero dependencies, ESM + CJS), `project-cli`, `app-module-project` |
| Commands (best structural pattern) | typed `Command` object (`command.ts`: name, summary, option specs, args, handler returning `{json, lines, mutation?}`); `dispatch.ts` `splitCommand` finds command words wherever options sit; `commands/index.ts` ordered list; `--json` and `-p` global; `cli update|version|rollback|logs|self-check|register|unregister`; per-day `logs/*.ndjson` with `cmd:`, `mutation:`, `exit N (CODE)` lines |
| State | `~/.config/project/registry.json` with lock file (stale after 30 s) and atomic writes; per-tool data `projects/<id>/<tool>/{config,data,cache,logs}` (`projectToolDir`) |
| app-core | `project cli register` stages the module; exit 0 for deferred/skipped, 1 for refused |
| Unverified | `project/flow`, `project/queue`, `project/task` (each holds only `src/`, probably stray); the project `.claude/specs` |

## Common patterns to reuse

1. Family-A layout: private `agent-manager-cli` workspace, CI-generated `@wadeck-app/agent-manager-cli`, esbuild CJS bundle + `-updater.cjs`, Go launcher, CalVer, `preversion` blocking local bumps; `cli update|version|rollback|logs|self-check|register|unregister` come from shared-cli/shared-updater.
2. Split `core` (storage), `service` (pure use cases), `cli`, `sdk` (zero dependencies, never throws), `app-module-*`; enforce direction with architecture tests; use `latest` for internal libraries.
3. Daemon: `singleton-daemon-kit` `createDaemon({configDir, port, commands, hooks})`, port env override, `config.port`, `health_token`, loopback only, idle shutdown, on-demand `start` in the SDK; never fixed ports in tests (port 0, isolated env).
4. Hooks thin and fast: call the SDK or `agent-manager <cmd>`, push to the daemon, swallow failures (but log them); small payloads, pass references.
5. Emit events through `queue-sdk` after state is saved, with an event-name catalog; agents wait with `queue wait --name <who>.<what>` instead of polling.
6. State as NDJSON/JSON under `~/.config/agent-manager` with locked or atomic writes; the web module reads files directly and goes through the daemon only for actions.
7. Web UI as an app-core module: `manifest.json` + `src/backend/index.ts` (`ctx.registerRoute`) + DSL views; `app-core-cli check` / `package` -> `dist-module`; `registerModule` on daemon start and `cli register` for a CLI without daemon; stage the module copy outside the npm folder (task, project).
8. Conventions: `--json` on every command with `{error, hint}`, actionable errors, explicit exit codes, no silent fallback, typed `Command` objects, `-p` project resolution via `project-sdk`, per-day command logs, isolated test env (`createIsolatedCliEnv`).
9. Plugin seams only if needed: a registry of built-ins (task) or an `ActionPlugin` registry (queue); both built-in only, loaded at start, no dynamic loading.
