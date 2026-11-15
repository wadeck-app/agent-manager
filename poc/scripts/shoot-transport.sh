#!/usr/bin/env bash
# Screenshots of the transport selector of the composer (closed, open) on the isolated instance at 2560x1440, into poc/results/transport-<state>.png.
# The module backend always uses the real `hc` command (no option to point it at fakeHc.mjs from the outside), so the list shows the real availability of
# the fake sessions: socket and hc as the status route reports them.
# Usage: bash shoot-transport.sh <port> <dir-with-inject.js> [session-id]
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=transport-shot
PORT="${1:?port}"; DIR="${2:?dir}"; SID="${3:-00000000-0000-4000-8000-000000000001}"
agent-browser set viewport 2560 1440 >/dev/null 2>&1
agent-browser open "http://127.0.0.1:$PORT/modules/agent-manager/agents?session=$SID&mode=tree" >/dev/null 2>&1
agent-browser wait 3000 >/dev/null 2>&1
agent-browser eval --stdin < "$DIR/inject.js" >/dev/null 2>&1
agent-browser eval "$(cat poc/scripts/hide-dock.js)" >/dev/null 2>&1
agent-browser screenshot poc/results/transport-closed.png >/dev/null 2>&1
agent-browser eval "(() => { const b = document.querySelector('[data-transport-picker] button'); b?.click(); return !!b; })()" 2>&1 | tail -1
agent-browser wait 800 >/dev/null 2>&1
agent-browser screenshot poc/results/transport-open.png >/dev/null 2>&1
agent-browser eval "(() => [...document.querySelectorAll('[data-transport]')].map((r) => r.innerText.replace(/\n+/g, ' | ')).join('\n'))()" 2>&1 | tail -4
agent-browser close >/dev/null 2>&1
