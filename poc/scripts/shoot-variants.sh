#!/usr/bin/env bash
# Screenshots every layout and sub-variant at 1440x900 and 800x700 into poc/results/ui-<list>-<sub>[-narrow].png. Usage: shoot-variants.sh [session-id]
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=am-ui-shots
BASE=http://127.0.0.1:48732/modules/agent-manager/agents
SEL=${1:+&session=$1}
shoot() { # list id sub
  local url="$BASE?ab.sessions-layout=$1&ab.$2=$3$SEL"
  for size in "1440 900:" "800 700:-narrow"; do
    agent-browser set viewport ${size%%:*} >/dev/null 2>&1
    agent-browser open "$url" >/dev/null 2>&1
    agent-browser wait 1800 >/dev/null 2>&1
    agent-browser screenshot "poc/results/ui-$1-$3${size##*:}.png" >/dev/null 2>&1
  done
  echo "shot $1 $3"
}
for s in comfortable compact preview; do shoot groups layout-groups-style $s; done
for s in tabs segmented autonext; do shoot inbox layout-inbox-style $s; done
for s in expanded attention rollup; do shoot tree layout-tree-style $s; done
for s in cards rail harness; do shoot tabs-cards layout-cards-style $s; done
for s in search facets minimal; do shoot palette layout-palette-style $s; done
agent-browser close >/dev/null 2>&1
