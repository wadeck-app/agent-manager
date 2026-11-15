#!/usr/bin/env bash
# Screenshots of the sub-agent side panel of the fake 70-sub-agent session (make-fake-subagents.mjs) into poc/results/ui6-<name>-<width>.png at 2560x1440,
# 1920x1080 and 1440x900: the default (Summary; collapsed under 1500 px), Timeline in both orders, the collapsed rail, the Failed filter.
# Usage: bash shoot-ui6.sh <port> <dir-with-inject.js> [only-width]
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=ui6-sub
PORT="${1:?port}"; DIR="${2:?dir with inject.js}"; ONLY="${3:-}"
SID=00000000-0000-4000-8000-000000000016
BASE="http://127.0.0.1:$PORT/modules/agent-manager/agents"
KEY=agent-manager.subagents.v1
# shoot <name> <prefs-json or empty for none> [js-to-run-in-the-page]
shoot() {
  for size in "2560 1440" "1920 1080" "1440 900"; do
    [ -n "$ONLY" ] && [ "${size%% *}" != "$ONLY" ] && continue
    agent-browser set viewport $size >/dev/null 2>&1
    if [ -n "$2" ]; then
      agent-browser storage local set "$KEY" "$2" >/dev/null 2>&1
    else
      agent-browser storage local clear >/dev/null 2>&1
    fi
    agent-browser open "$BASE?session=$SID" >/dev/null 2>&1
    agent-browser wait 2500 >/dev/null 2>&1
    agent-browser eval --stdin < "$DIR/inject.js" >/dev/null 2>&1
    agent-browser eval "$(cat poc/scripts/hide-dock.js)" >/dev/null 2>&1
    if [ -n "$3" ]; then
      agent-browser eval "$3" >/dev/null 2>&1
    fi
    agent-browser wait 600 >/dev/null 2>&1
    agent-browser screenshot "poc/results/ui6-$1-${size%% *}.png" >/dev/null 2>&1
    echo "shot $1 $size"
  done
}
agent-browser open "$BASE" >/dev/null 2>&1
shoot default ""
shoot summary-open '{"collapsed":false,"mode":"summary","order":"recent"}'
shoot timeline-recent '{"collapsed":false,"mode":"timeline","order":"recent"}'
shoot timeline-oldest '{"collapsed":false,"mode":"timeline","order":"oldest"}'
shoot rail '{"collapsed":true,"mode":"summary","order":"recent"}'
shoot filter-failed '{"collapsed":false,"mode":"summary","order":"recent"}' "(() => { const b = [...document.querySelectorAll('aside[aria-label=\"Sub-agents\"] button')].find((x) => /^Failed/.test(x.textContent)); b?.click(); return !!b; })()"
agent-browser close >/dev/null 2>&1
