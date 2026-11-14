#!/usr/bin/env bash
# Verifies, in an isolated temp environment, the real update path: the PREVIOUS published version updates itself to <version>,
# rolls back, and updates again.
#
# Usage:       bash packages/agent-manager-cli/ci/scripts/verify-update.sh <version>
# Run locally: same requirements as verify-install.sh. The previous version is taken from the registry
#              (npm view @wadeck-app/agent-manager-cli versions --json), see previous-version.mjs. Skipped, with a log line, when there is none.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/verify-lib.sh"

VERSION="${1:-}"
[ -n "$VERSION" ] || fail "usage: verify-update.sh <version>"
PACKAGE="@wadeck-app/agent-manager-cli"

isolate_env

step "(e0) find the version published before $VERSION"
VERSIONS=""
for attempt in 1 2 3 4; do
  status=0
  VERSIONS="$(npm view "$PACKAGE" versions --json 2> "$(last_stderr_file)")" || status=$?
  if [ "$status" -eq 0 ]; then
    break
  fi
  echo "npm view $PACKAGE versions failed (attempt $attempt of 4), retrying in 10 s"
  cat "$(last_stderr_file)" >&2
  sleep 10
done
[ "$status" -eq 0 ] || fail "npm view $PACKAGE versions --json did not succeed after 4 attempts"
PREVIOUS="$(printf '%s' "$VERSIONS" | node "$SCRIPT_DIR/previous-version.mjs" "$VERSION" | tr -d '\r')"
if [ -z "$PREVIOUS" ]; then
  echo "SKIPPED: there is no version published before $VERSION, nothing to update from (first publication)"
  exit 0
fi
echo "previous version: $PREVIOUS"
# app-core is not running here (isolate_env: APP_CORE_PORT is a port where nothing listens, APP_CORE_CONFIG_DIR a temp folder): a registration is
# left for its next start (deferred), it neither fails nor is skipped silently, and the app-core of the user is never reached.
echo "APP_CORE_PORT=$APP_CORE_PORT APP_CORE_CONFIG_DIR=$APP_CORE_CONFIG_DIR"

step "(e1) npm install -g $PACKAGE@$PREVIOUS"
install_global "$PACKAGE@$PREVIOUS"
first_run
ACTUAL="$(installed_version)"
assert_equals "installed version" "$PREVIOUS" "$ACTUAL"

# The registration after an update is done by the updater of the version being REPLACED, not by the new one: the check below can only
# hold for a previous version whose updater knows how (its bundle carries the capability marker, see UPDATER_CAPABILITIES). The previous
# versions published before the app-module existed have no such updater: the check is skipped, loudly.
MARKER="reregister-on-update:v1"
if grep -q "$MARKER" "$(installed_package_dir)/agent-manager-updater.cjs"; then
  PREVIOUS_RE_REGISTERS=1
  echo "the updater of $PREVIOUS carries '$MARKER': the update from it is checked to re-register the app-module"
else
  PREVIOUS_RE_REGISTERS=0
  echo "the updater of $PREVIOUS has no '$MARKER': it cannot re-register the app-module after an update"
fi
PREVIOUS_SHIPS_APP_MODULE=0
if [ -f "$(installed_package_dir)/app-module/manifest.json" ]; then
  PREVIOUS_SHIPS_APP_MODULE=1
fi
echo "previous version ships the app-module: $PREVIOUS_SHIPS_APP_MODULE"

step "(e2) agent-manager cli update installs $VERSION"
update_to "$VERSION"

step "(e2b) the update did NOT register the app-module: the first registration is explicit"
[ ! -e "$XDG_CONFIG_HOME/agent-manager/app-module" ] || fail "the update staged the app-module although it was never registered ($XDG_CONFIG_HOME/agent-manager/app-module)"
[ ! -e "$APP_CORE_CONFIG_DIR/modules/agent-manager.json" ] || fail "the update registered the app-module with app-core although it was never registered"
echo "ok: nothing was registered by the update"

step "(e2c) agent-manager cli register (app-core is not running: deferred)"
run_cli cli register --json || fail "agent-manager cli register exited with status $?"
assert_contains "agent-manager cli register" "\"status\": \"deferred\"" "$(last_stdout)"
assert_file "the staged copy of the app-module" "$XDG_CONFIG_HOME/agent-manager/app-module/$VERSION/manifest.json"
assert_file "the pending registration for app-core" "$APP_CORE_CONFIG_DIR/modules/agent-manager.json"

step "(e3) agent-manager cli rollback puts $PREVIOUS back"
run_cli cli rollback || fail "agent-manager cli rollback exited with status $?"
ACTUAL="$(installed_version)"
assert_equals "installed version after the rollback" "$PREVIOUS" "$ACTUAL"

# The module was registered before: this update must register it again. The pending registration is removed to see it come back.
rm -f "$APP_CORE_CONFIG_DIR/modules/agent-manager.json"

step "(e4) agent-manager cli update installs $VERSION again, and registers the app-module again (it was registered)"
update_to "$VERSION"
assert_file "the staged copy of the app-module after the second update" "$XDG_CONFIG_HOME/agent-manager/app-module/$VERSION/manifest.json"
if [ "$PREVIOUS_SHIPS_APP_MODULE" = "1" ] && [ "$PREVIOUS_RE_REGISTERS" = "1" ]; then
  assert_file "the pending registration for app-core, written by the update" "$APP_CORE_CONFIG_DIR/modules/agent-manager.json"
  assert_contains "the log file of the updater" "re-registering the Agents pages" "$(cat "$XDG_CONFIG_HOME"/agent-manager/logs/*.ndjson)"
elif [ "$PREVIOUS_SHIPS_APP_MODULE" != "1" ]; then
  echo "SKIPPED: the pending registration written by the update: $PREVIOUS ships no app-module, so its updater cannot register one (the check applies from the next release on)"
else
  echo "SKIPPED: the pending registration written by the update: the updater that ran is the one of $PREVIOUS, which has no '$MARKER' (it is the first release after that one that can be checked this way)"
fi

echo
echo "verify-update: all steps passed ($PREVIOUS -> $VERSION -> $PREVIOUS -> $VERSION) on $(uname -s)"
