# @wadeck-app/agent-manager-cli

`agent-manager`: follow and answer your Claude Code sessions.

**Status: M1 skeleton only. The daemon, hooks and UI are not implemented.** `start`, `stop`, `status`, `cli register` and `cli unregister` exit 1 with `... not implemented yet (planned M1b)`.

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
| `agent-manager start` / `stop` / `status` | fails: daemon not implemented yet |
| `agent-manager cli register` / `unregister` | fails: app-core module not implemented yet |

Config folder: `$AGENT_MANAGER_CONFIG_DIR`, else `$XDG_CONFIG_HOME/agent-manager`, else `~/.config/agent-manager`. Set `autoUpdate: false` in its `config.yml` to stop the background update.
