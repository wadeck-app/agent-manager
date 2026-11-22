#!/usr/bin/env bash
# Throwaway: the Herdr rows at list widths. Usage: bash ui-audit-rows.sh <port> <viewportW> <listWidth|-> <mode:tree|custom> <density> <outname>
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=ui-audit
PORT="${1:?}"; W="${2:?}"; LW="${3:?}"; MODE="${4:?}"; DENS="${5:?}"; OUT="${6:?}"
B="http://127.0.0.1:$PORT/modules/agent-manager"
agent-browser set viewport "$W" 800 >/dev/null
agent-browser open "$B/agents?mode=$MODE&ab.ui-tree-density=$DENS" >/dev/null
if [ "$LW" != "-" ]; then agent-browser eval "localStorage.setItem('agent-manager.listWidth.v2','$LW')" >/dev/null; agent-browser open "$B/agents?mode=$MODE&ab.ui-tree-density=$DENS" >/dev/null; fi
agent-browser wait 2500 >/dev/null
agent-browser eval "$(cat poc/scripts/hide-dock.js)" >/dev/null
agent-browser screenshot "$PWD/poc/results/ui-audit/$OUT.png" >/dev/null
echo "shot $OUT"
