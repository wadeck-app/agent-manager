#!/usr/bin/env bash
# Throwaway: one screenshot per option of every A/B question of the UI audit, on the REAL page (forced with the dock link parameter ?ab.<id>=<option>, then
# read back from the dock to prove the choice was applied). Usage: bash ui-audit-variants.sh <port> [width] [height]
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=ui-audit
PORT="${1:?port}"; W="${2:-1440}"; H="${3:-900}"
B="http://127.0.0.1:$PORT/modules/agent-manager/agents"
S=00000000-0000-4000-8000-0000000000
OUT=poc/results/ui-audit/variants
mkdir -p "$OUT"
agent-browser set viewport "$W" "$H" >/dev/null; [ -n "${ONLY_GROUPS:-}" ] && SKIP=1
# shoot <question-id> <option> <query-after-session> <file>
shoot() {
  agent-browser storage local clear >/dev/null
  agent-browser open "$B?$3&ab.$1=$2" >/dev/null
  agent-browser wait 3000 >/dev/null
  echo "$1=$2 stored: $(agent-browser eval "localStorage.getItem('ab.$1')" 2>&1 | tail -1)"
  agent-browser eval "$(cat poc/scripts/hide-dock.js)" >/dev/null
  [ -n "$5" ] && agent-browser eval "$5" >/dev/null && agent-browser wait 500 >/dev/null
  agent-browser screenshot "$OUT/$4.png" >/dev/null
}
for o in inline menu split; do shoot ui-header-actions $o "session=${S}01" "header-actions-$o-$W"; done
for o in comfortable compact card; do shoot ui-tree-density $o "mode=tree" "tree-density-$o-$W"; done
for o in soft outline dot; do shoot ui-chip-style $o "session=${S}01" "chip-style-$o-$W"; done
for o in badge button banner; do shoot ui-switch-readiness $o "session=${S}01" "switch-readiness-$o-$W"; done
for o in hover always labelled; do shoot ui-thread-placement $o "session=${S}09" "thread-placement-$o-$W"; done
# The group header needs custom groups in the browser's storage-backed state (module state file), so it is shot WITHOUT clearing: groups were made through the UI first.
for o in bar plain pill; do
  agent-browser open "$B?mode=tree&ab.ui-group-header=$o" >/dev/null; agent-browser wait 3000 >/dev/null
  agent-browser eval "$(cat poc/scripts/hide-dock.js)" >/dev/null
  agent-browser screenshot "$OUT/group-header-$o-$W.png" >/dev/null; echo "group-header=$o"
done
