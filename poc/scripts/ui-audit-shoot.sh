#!/usr/bin/env bash
# Throwaway: screenshots of every surface of the module into poc/results/ui-audit/<name>-<width>.png. Usage: bash ui-audit-shoot.sh <port> <width> <height> [suffix]
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=ui-audit
PORT="${1:?port}"; W="${2:?w}"; H="${3:?h}"; SUF="${4:-}"
B="http://127.0.0.1:$PORT/modules/agent-manager"
S=00000000-0000-4000-8000-0000000000
OUT=poc/results/ui-audit
agent-browser set viewport "$W" "$H" >/dev/null
shot() { agent-browser open "$B/$2" >/dev/null; agent-browser wait 2500 >/dev/null; agent-browser screenshot "$OUT/$1-$W$SUF.png" >/dev/null; echo "shot $1 $W"; }
shot list agents
shot detail-fork "agents?session=${S}03"
shot detail-thread "agents?session=${S}09"
shot detail-hc "agents?session=${S}05"
shot detail-bg "agents?session=${S}08"
shot detail-exited "agents?session=${S}04"
shot detail-interrupted "agents?session=${S}13"
shot detail-switchfail "agents?session=${S}06"
shot detail-running "agents?session=${S}07"
shot groups "agents?mode=groups"
shot inbox "agents?mode=inbox"
shot table table
shot guardrails guardrails
