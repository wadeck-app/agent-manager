#!/usr/bin/env bash
# Screenshots every list variant (log style chat) at 1440x900 and 800x700, and the three log styles, into poc/results/ui2-*.png.
# Usage: shoot-ui2.sh [port] [session-id]   (the isolated instance of ui-dev.sh; the A/B dock must be collapsed once: ab.collapsed in localStorage)
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=am-ui2-shots
PORT="${1:-48740}"
SID="${2:-00000000-0000-4000-8000-000000000001}"
BASE="http://127.0.0.1:$PORT/modules/agent-manager/agents"
shoot() { # name "id=value id=value ..."  (the A/B choices go through localStorage: a ?ab.x= link expands the dock over the page)
  for size in "1440 900:" "800 700:-narrow"; do
    agent-browser set viewport ${size%%:*} >/dev/null 2>&1
    for pair in $2; do agent-browser storage local set "ab.${pair%%=*}" "${pair#*=}" >/dev/null 2>&1; done
    agent-browser open "$BASE?session=$SID" >/dev/null 2>&1
    agent-browser wait 2200 >/dev/null 2>&1
    # The A/B dock (dev tool) covers the bottom of the page: hide it for the picture only.
    agent-browser eval "(()=>{const t=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent==='Log style');let n=t;while(n&&getComputedStyle(n).position!=='fixed'){n=n.parentElement}if(n){n.style.display='none'}return !!n})()" >/dev/null 2>&1
    agent-browser screenshot "poc/results/ui2-$1${size##*:}.png" >/dev/null 2>&1
  done
  echo "shot $1"
}
agent-browser open "$BASE" >/dev/null 2>&1
list() { shoot "$1-$3" "sessions-layout=$1 $2=$3 detail-log-style=chat"; }
for s in comfortable compact preview; do list groups layout-groups-style $s; done
for s in tabs segmented autonext; do list inbox layout-inbox-style $s; done
for s in expanded attention rollup; do list tree layout-tree-style $s; done
for s in cards rail harness; do list tabs-cards layout-cards-style $s; done
for s in search facets minimal; do list palette layout-palette-style $s; done
for s in chat timeline compact; do shoot "log-$s" "sessions-layout=groups layout-groups-style=compact detail-log-style=$s"; done
shoot table "sessions-layout=table"
agent-browser close >/dev/null 2>&1
