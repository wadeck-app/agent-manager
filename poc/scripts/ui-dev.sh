#!/usr/bin/env bash
# Isolated app-core with the module and fake sessions (see make-fake-sessions.mjs, make-fake-transcripts.mjs, fake-pipe.mjs). Never touches port 4850 or the real config.
# Environment (all optional): AM_UI_ROOT (temp root: appcore/, sessions/, amconfig/, xdg/ below it), AM_UI_PORT (default 48732),
# AM_UI_PROJECTS (a folder made by make-fake-transcripts.mjs: the transcripts the log reads instead of ~/.claude/projects).
set -e
cd "$(dirname "$0")/../../packages/app-module-agent-manager"
T="${AM_UI_ROOT:-C:\\Users\\Wadeck\\AppData\\Local\\Temp\\am-ui}"
PORT="${AM_UI_PORT:-48732}"
export APP_CORE_CONFIG_DIR="$T\\appcore" AGENT_MANAGER_SESSIONS_DIR="$T\\sessions" AGENT_MANAGER_CONFIG_DIR="$T\\amconfig" XDG_CONFIG_HOME="$T\\xdg" APP_CORE_PORT="$PORT"
if [ -n "${AM_UI_PROJECTS:-}" ]; then
  export AGENT_MANAGER_PROJECTS_DIR="$AM_UI_PROJECTS"
fi
../../node_modules/.bin/tsx src/dsl-components/build/generate-entries.ts
../../node_modules/.bin/tsx src/dsl-components/build/build-css.ts
exec ../../node_modules/.bin/app-core-cli dev . --port "$PORT" --ab-tests --no-tray --no-update --watch
