#!/usr/bin/env bash
# Live-update repro in a browser: opens a fake session, appends the lines of a "web reply" (append-live-peer.mjs) while the page is open, and records what the
# page shows every 3 s for a 21 s window (the number of answers shown, the log requests the page made).
# Usage: bash watch-live.sh <port> <dir-with-inject.js> <root> [hidden|send]
#   hidden: the tab is hidden while the lines are appended, visible again at t+15s.
#   send:   the message is typed in the composer and sent first (needs fake-pipe.mjs running on <root>/sessions: session 3 is wired to it).
# Env: LIVE_SID (default session 2, billing), LIVE_FOLDER (its folder, default billing). Nothing but the transcript of the fake session is written.
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=live-watch
PORT="${1:?port}"; DIR="${2:?dir}"; ROOT="${3:?root}"; MODE="${4:-}"
SID="${LIVE_SID:-00000000-0000-4000-8000-000000000002}"; FOLDER="${LIVE_FOLDER:-billing}"
FILE="$ROOT/projects/C--Workspace-Tooling-$FOLDER/$SID.jsonl"
agent-browser set viewport 2560 1440 >/dev/null 2>&1
agent-browser open "http://127.0.0.1:$PORT/modules/agent-manager/agents?session=$SID&mode=tree" >/dev/null 2>&1
agent-browser wait 3000 >/dev/null 2>&1
agent-browser eval --stdin < "$DIR/inject.js" >/dev/null 2>&1
agent-browser network requests --clear >/dev/null 2>&1
if [ "$MODE" = "hidden" ]; then
  agent-browser eval "(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); return 'hidden'; })()" >/dev/null 2>&1
fi
if [ "$MODE" = "send" ]; then
  agent-browser find placeholder "Message the agent (Enter sends, Shift+Enter adds a line)" fill "salut" >/dev/null 2>&1
  agent-browser press Enter >/dev/null 2>&1
  agent-browser wait 1500 >/dev/null 2>&1
  echo "sent from the composer"
fi
node poc/scripts/append-live-peer.mjs "$FILE" "$SID" "C:\\Workspace_Tooling\\$FOLDER" 3000 4000 "http://127.0.0.1:$PORT/api/modules/agent-manager/sessions/$SID/reply/status" &
APPENDER=$!
for t in 1 2 3 4 5 6 7; do
  agent-browser wait 3000 >/dev/null 2>&1
  echo "--- t+$((t*3))s"
  agent-browser eval "(() => 'answers=' + ([...document.querySelectorAll('[data-agent-detail]')].map((d) => d.innerText).join(' ').match(/Salut ! I got/g) || []).length)()" 2>&1 | tail -1
  if [ "$MODE" = "hidden" ] && [ "$t" = "5" ]; then
    agent-browser eval "(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); return 'visible again'; })()" 2>&1 | tail -1
  fi
done
wait $APPENDER
echo "--- requests of the page (log polls)"
agent-browser network requests 2>&1 | grep -E "/log|/reply" | sed -e 's/.*\/modules\/agent-manager//' | head -40
agent-browser screenshot "poc/results/live-watch-${MODE:-plain}.png" >/dev/null 2>&1
agent-browser close >/dev/null 2>&1
