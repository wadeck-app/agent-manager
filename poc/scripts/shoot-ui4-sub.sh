#!/usr/bin/env bash
# Screenshots of every sub-agent layout x content variant of the fake session with 70 sub-agents (make-fake-subagents.mjs) into poc/results/ui4-sub-<layout>-<content>-<width>.png.
# Usage: bash shoot-ui4-sub.sh <port> <dir-with-inject.js> [sizes: "2560x1440 1920x1080 1440x900"] [layouts] [contents]
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=ui4-sub
PORT="${1:?port}"; DIR="${2:?dir with inject.js}"; SIZES="${3:-2560x1440 1920x1080 1440x900}"; LAYOUTS="${4:-panel strip badge}"; CONTENTS="${5:-summary groups timeline}"
SID=00000000-0000-4000-8000-000000000016
BASE="http://127.0.0.1:$PORT/modules/agent-manager/agents"
agent-browser open "$BASE" >/dev/null 2>&1
for size in $SIZES; do
  agent-browser set viewport "${size%x*}" "${size#*x}" >/dev/null 2>&1
  for layout in $LAYOUTS; do
    for content in $CONTENTS; do
      agent-browser storage local set ab.subagents-layout "$layout" >/dev/null 2>&1
      agent-browser storage local set ab.subagents-content "$content" >/dev/null 2>&1
      agent-browser open "$BASE?session=$SID" >/dev/null 2>&1
      agent-browser wait 2500 >/dev/null 2>&1
      agent-browser eval --stdin < "$DIR/inject.js" >/dev/null 2>&1
      agent-browser eval "$(cat poc/scripts/hide-dock.js)" >/dev/null 2>&1
      # The strip and the badge are closed at first: open them (the panel is always open when the window is wide enough).
      agent-browser eval "(() => { const s = document.querySelector('[data-agent-detail] section[aria-label=\"Sub-agents\"] > button'); const b = document.querySelector('[data-agent-detail] button[aria-haspopup=\"dialog\"]'); (s || b)?.click(); return !!(s || b); })()" >/dev/null 2>&1
      agent-browser wait 600 >/dev/null 2>&1
      agent-browser screenshot "poc/results/ui4-sub-$layout-$content-${size%x*}.png" >/dev/null 2>&1
      echo "shot $layout $content $size"
    done
  done
done
agent-browser close >/dev/null 2>&1
