#!/usr/bin/env bash
# Screenshots of the left menu on the Agents page and on the Table page (exactly one entry must be highlighted on each, the breadcrumb must read
# "Agents > Table") into poc/results/menu-<page>.png, and prints the entries the shell marks current (aria-current) and the breadcrumb text.
# Usage: bash shoot-menu.sh <port> <dir-with-inject.js>
cd "$(dirname "$0")/../.."
export AGENT_BROWSER_SESSION=menu-shots
PORT="${1:?port}"; DIR="${2:?dir with inject.js}"
BASE="http://127.0.0.1:$PORT/modules/agent-manager"
agent-browser set viewport 1920 1080 >/dev/null 2>&1
for page in agents table; do
  agent-browser open "$BASE/$page" >/dev/null 2>&1
  agent-browser wait 2500 >/dev/null 2>&1
  agent-browser eval --stdin < "$DIR/inject.js" >/dev/null 2>&1
  agent-browser eval "$(cat poc/scripts/hide-dock.js)" >/dev/null 2>&1
  echo "--- $page"
  agent-browser eval "(() => 'current: ' + JSON.stringify([...document.querySelectorAll('[aria-current]')].map((e) => e.textContent.trim() + ' @ ' + e.getAttribute('aria-current'))) + ' | breadcrumb: ' + (document.querySelector('nav[aria-label*=\"readcrumb\"]')?.innerText ?? '(none)').replace(/\\s+/g, ' '))()" 2>&1 | tail -1
  agent-browser screenshot "poc/results/menu-$page.png" >/dev/null 2>&1
done
agent-browser close >/dev/null 2>&1
