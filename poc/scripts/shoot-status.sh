#!/usr/bin/env bash
# Screenshots of the status info row of the fake session of make-fake-status.mjs into poc/results/status-<width>.png at 2560x1440 and 1440x900.
# Usage: bash shoot-status.sh <port> <dir-with-inject.js>
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=status-shots
PORT="${1:?port}"; DIR="${2:?dir}"
SID=00000000-0000-4000-8000-000000000017
BASE="http://127.0.0.1:$PORT/modules/agent-manager/agents"
agent-browser open "$BASE" >/dev/null 2>&1
for size in "2560 1440" "1440 900"; do
  agent-browser set viewport $size >/dev/null 2>&1
  agent-browser storage local clear >/dev/null 2>&1
  agent-browser open "$BASE?session=$SID&mode=tree" >/dev/null 2>&1
  agent-browser wait 3000 >/dev/null 2>&1
  agent-browser eval --stdin < "$DIR/inject.js" >/dev/null 2>&1
  agent-browser eval "$(cat poc/scripts/hide-dock.js)" >/dev/null 2>&1
  agent-browser wait 600 >/dev/null 2>&1
  agent-browser screenshot "poc/results/status-${size%% *}.png" >/dev/null 2>&1
  echo "shot $size"
done
agent-browser close >/dev/null 2>&1
