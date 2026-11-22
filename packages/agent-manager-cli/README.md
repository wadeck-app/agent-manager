# @wadeck-app/agent-manager-cli

`agent-manager`: follow and answer your Claude Code sessions.

**Status: partial slice.** The Agents pages in app-core (`agent-manager cli register`), fed by the Claude Code session registry (`~/.claude/sessions`, override `AGENT_MANAGER_SESSIONS_DIR`). Liveness is pid-only (a reused pid shows a dead session alive). Daemon (owned sessions): `start [--detach]`, `stop`, `status` (exit 3 when it is not running); no hooks or transcripts yet.

## Install

GitHub Packages. Needs the scope registry and a token with `read:packages` in `~/.npmrc`:

```
@wadeck-app:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<token>
```

```
npm install -g @wadeck-app/agent-manager-cli
agent-manager -v
```

## Commands

| Command | State |
|---|---|
| `agent-manager -v` / `--version` | works |
| `agent-manager cli version` | works: installed and latest version |
| `agent-manager cli update [--check] [--log]` | works: updates the global install (refuses a development build) |
| `agent-manager cli rollback` | works: reinstalls the previous version |
| `agent-manager cli logs [--follow]` | works |
| `agent-manager cli self-check` | works |
| `agent-manager start [--detach]` / `stop` / `status` | the daemon that hosts the sessions agent-manager launches; port 47930 or `AGENT_MANAGER_DAEMON_PORT`; `status` exits 3 when it is not running |
| `agent-manager cli register` | works: shows the Agents pages in app-core (see below) |
| `agent-manager cli unregister` | works: removes them, and stops updates from registering them again |

Config folder: `$AGENT_MANAGER_CONFIG_DIR`, else `$XDG_CONFIG_HOME/agent-manager`, else `~/.config/agent-manager`. Set `autoUpdate: false` in its `config.yml` to stop the background update.

## App-core pages

The package ships the app-core module `agent-manager` (`app-module/`, title Agents: page `/agents`, dashboard widget). `cli register` copies it to `<config folder>/app-module/<version>/` and registers that copy; the first registration is explicit, afterwards an update that changed the module re-registers it. Same outcomes and exit codes as `project cli register`:

| Outcome | Exit | Meaning |
|---|---|---|
| `registered` | 0 | app-core loaded the module |
| `deferred` | 0 | app-core is not running; it loads the module at its next start |
| `skipped` | 0 | app-core is not installed |
| `unconfirmed` | 0 | no answer in time; wait, then run `register` again |
| `refused`, `failed` | 1 | the message says what to fix |

`--json` prints `{ ok, status, message }`. The page lists the sessions (dead ones hidden unless `?show=all`), polls every 5 s, shows unreadable registry files and a missing registry folder as visible errors, and has a table page (`/table`) next to the workspace page (`/agents`). Module docs: `packages/app-module-agent-manager/README.md`.
