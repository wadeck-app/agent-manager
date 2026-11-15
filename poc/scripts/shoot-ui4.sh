#!/usr/bin/env bash
# Screenshots + workspace measures of every list variant at 1440x900, 1920x1080, 2560x1440 into poc/results/ui4-<name>-<width>.png, on the isolated instance
# of ui-dev.sh with the sheets of the other modules adopted after ours. Usage: bash shoot-ui4.sh <port> <dir-with-inject.js> [session-id]
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=ui4-shots
PORT="${1:?port}"; DIR="${2:?dir with inject.js}"; SID="${3:-00000000-0000-4000-8000-000000000001}"
BASE="http://127.0.0.1:$PORT/modules/agent-manager/agents"
shoot() { # name layout [extra-url]
  for size in "1440 900" "1920 1080" "2560 1440"; do
    agent-browser set viewport $size >/dev/null 2>&1
    agent-browser storage local set ab.sessions-layout "$2" >/dev/null 2>&1
    agent-browser storage local set ab.detail-log-style chat >/dev/null 2>&1
    agent-browser open "$BASE?session=$SID$3" >/dev/null 2>&1
    agent-browser wait 2200 >/dev/null 2>&1
    agent-browser eval --stdin < "$DIR/inject.js" >/dev/null 2>&1
    agent-browser eval "$(cat poc/scripts/hide-dock.js)" >/dev/null 2>&1
    agent-browser wait 500 >/dev/null 2>&1
    echo "$1 ${size// /x}: $(agent-browser eval "$(cat poc/scripts/measure-workspace.js)" 2>&1)"
    agent-browser screenshot "poc/results/ui4-$1-${size%% *}.png" >/dev/null 2>&1
  done
}
agent-browser open "$BASE" >/dev/null 2>&1
shoot groups groups
shoot tree tree
shoot palette palette
shoot inbox inbox
shoot tabs-cards tabs-cards
shoot table table ""
agent-browser close >/dev/null 2>&1
