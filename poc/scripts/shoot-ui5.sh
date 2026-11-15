#!/usr/bin/env bash
# Screenshots of the toggle modes, their view options, the search and the table page at 2560x1440, 1920x1080, 1440x900 into poc/results/ui5-<name>-<width>.png,
# on the isolated instance of ui-dev.sh with the sheets of the other modules adopted after ours (see shoot-ui4.sh).
# Usage: bash shoot-ui5.sh <port> <dir-with-inject.js> [session-id] [only-width]
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=ui5-shots
PORT="${1:?port}"; DIR="${2:?dir with inject.js}"; SID="${3:-00000000-0000-4000-8000-000000000001}"; ONLY="${4:-}"
BASE="http://127.0.0.1:$PORT/modules/agent-manager"
OPT_DEFAULT='{}'
OPT_FLAT='{"tree":{"grouping":"none","expansion":"all"}}'
OPT_ATTENTION='{"tree":{"grouping":"workspace","expansion":"attention"}}'
OPT_NOPREVIEW='{"groups":{"preview":false}}'
OPT_AUTONEXT='{"inbox":{"autoNext":true}}'
# shoot <name> <path> <options-json> [search-text] [click-label]
shoot() {
  for size in "2560 1440" "1920 1080" "1440 900"; do
    [ -n "$ONLY" ] && [ "${size%% *}" != "$ONLY" ] && continue
    agent-browser set viewport $size >/dev/null 2>&1
    agent-browser storage local set agent-manager.viewOptions "$3" >/dev/null 2>&1
    agent-browser open "$BASE/$2" >/dev/null 2>&1
    agent-browser wait 2200 >/dev/null 2>&1
    agent-browser eval --stdin < "$DIR/inject.js" >/dev/null 2>&1
    agent-browser eval "$(cat poc/scripts/hide-dock.js)" >/dev/null 2>&1
    if [ -n "$4" ]; then
      agent-browser find placeholder "Search, or state:done project:shop (press /)" fill "$4" >/dev/null 2>&1
    fi
    if [ -n "$5" ]; then
      agent-browser find role button click --name "$5" >/dev/null 2>&1
    fi
    agent-browser wait 500 >/dev/null 2>&1
    echo "$1 ${size// /x}: $(agent-browser eval "$(cat poc/scripts/measure-workspace.js)" 2>&1 | cut -c1-200)"
    agent-browser screenshot "poc/results/ui5-$1-${size%% *}.png" >/dev/null 2>&1
  done
}
agent-browser open "$BASE/agents" >/dev/null 2>&1
shoot tree "agents?mode=tree&session=$SID" "$OPT_DEFAULT"
shoot tree-flat "agents?mode=tree&session=$SID" "$OPT_FLAT"
shoot tree-attention "agents?mode=tree&session=$SID" "$OPT_ATTENTION"
shoot groups "agents?mode=groups&session=$SID" "$OPT_DEFAULT"
shoot groups-nopreview "agents?mode=groups&session=$SID" "$OPT_NOPREVIEW"
shoot inbox "agents?mode=inbox&tab=all&session=$SID" "$OPT_DEFAULT"
shoot inbox-options "agents?mode=inbox&tab=all&session=$SID" "$OPT_AUTONEXT" "" "View options"
shoot tree-options "agents?mode=tree&session=$SID" "$OPT_DEFAULT" "" "View options"
shoot search-tree "agents?mode=tree&session=$SID" "$OPT_DEFAULT" "owner"
shoot search-groups "agents?mode=groups&session=$SID" "$OPT_DEFAULT" "state:working"
shoot search-inbox "agents?mode=inbox&tab=all&session=$SID" "$OPT_DEFAULT" "ow"
shoot search-empty "agents?mode=tree&session=$SID" "$OPT_DEFAULT" "zzzz"
shoot badmode "agents?mode=cards&session=$SID" "$OPT_DEFAULT"
shoot table "agents/table" "$OPT_DEFAULT"
agent-browser close >/dev/null 2>&1
