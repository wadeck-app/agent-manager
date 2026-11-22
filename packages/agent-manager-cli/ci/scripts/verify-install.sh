#!/usr/bin/env bash
# Verifies, in an isolated temp environment, that a published version of @wadeck-app/agent-manager-cli installs and works.
#
# Usage:       bash packages/agent-manager-cli/ci/scripts/verify-install.sh <version>
# Run locally: needs bash (git-bash on Windows), node >= 22, npm configured for GitHub Packages
#              (@wadeck-app:registry=https://npm.pkg.github.com and a token with read:packages).
#              Nothing outside a temp folder is touched: the global npm prefix, the config folder and the home are redirected.
# Step (d) asserts the behavior of status and stop with no daemon running (a real start/stop smoke test is still to add); step (e)
#              checks the app-module (the Agents pages of app-core) and its registration, against a port where nothing listens and a temp
#              app-core config folder: the app-core of the user is never reached.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/verify-lib.sh"

VERSION="${1:-}"
[ -n "$VERSION" ] || fail "usage: verify-install.sh <version>"

isolate_env

step "(a) npm install -g @wadeck-app/agent-manager-cli@$VERSION"
install_global "@wadeck-app/agent-manager-cli@$VERSION"
assert_platform_package_installed
first_run

step "(b) agent-manager --version prints exactly the version"
ACTUAL="$(installed_version)"
assert_equals "agent-manager --version" "$VERSION" "$ACTUAL"

step "(c) agent-manager cli self-check exits 0"
run_cli cli self-check || fail "agent-manager cli self-check exited with status $?"
echo "ok: self-check passed"

step "(d) with no daemon running: status fails explicitly (exit 3, with the fix), stop is a no-op that says so"
# `start` is not run here: it would leave a daemon process on the runner (the daemon itself is covered by the tests of the package).
status_code=0
run_cli status || status_code=$?
[ "$status_code" -eq 3 ] || fail "agent-manager status exited $status_code with no daemon running: expected 3"
assert_contains "agent-manager status" "daemon is not running" "$(last_stderr)"
assert_contains "agent-manager status" "agent-manager start --detach" "$(last_stderr)"
run_cli stop || fail "agent-manager stop exited with status $? with no daemon running: it must be a no-op"
assert_contains "agent-manager stop" "nothing to stop" "$(last_stdout)"

step "(e) the package ships the app-module (the Agents pages of app-core) and 'agent-manager cli register' defers it when app-core is not running"
PACKAGE_DIR="$(installed_package_dir)"
assert_file "the packaged manifest of the app-module" "$PACKAGE_DIR/app-module/manifest.json"
assert_contains "the packaged manifest of the app-module" "\"id\": \"agent-manager\"" "$(cat "$PACKAGE_DIR/app-module/manifest.json")"
assert_contains "the packaged manifest of the app-module" "\"version\": \"$VERSION\"" "$(cat "$PACKAGE_DIR/app-module/manifest.json")"
# isolate_env already pointed APP_CORE_PORT at a port where nothing listens and APP_CORE_CONFIG_DIR at a temp folder.
echo "APP_CORE_PORT=$APP_CORE_PORT APP_CORE_CONFIG_DIR=$APP_CORE_CONFIG_DIR"
run_cli cli register --json || fail "agent-manager cli register exited with status $? (it must defer when app-core is not running)"
assert_contains "agent-manager cli register" "\"status\": \"deferred\"" "$(last_stdout)"
# The copy app-core will load at its next start lives in the config folder: it must survive an update or removal of the npm folder.
assert_file "the staged copy of the app-module" "$XDG_CONFIG_HOME/agent-manager/app-module/$VERSION/manifest.json"
assert_file "the pending registration for app-core" "$APP_CORE_CONFIG_DIR/modules/agent-manager.json"
run_cli cli unregister --json || fail "agent-manager cli unregister exited with status $?"
[ ! -e "$APP_CORE_CONFIG_DIR/modules/agent-manager.json" ] || fail "agent-manager cli unregister left the pending registration $APP_CORE_CONFIG_DIR/modules/agent-manager.json"
[ ! -e "$XDG_CONFIG_HOME/agent-manager/app-module" ] || fail "agent-manager cli unregister left the staged copy $XDG_CONFIG_HOME/agent-manager/app-module"
echo "ok: the pending registration and the staged copy were removed"

step "(f) with no app-core config folder at all (app-core not installed), cli register is skipped: exit 0, nothing written there"
MISSING_APP_CORE_DIR="$VERIFY_ROOT/no-app-core-installed"
APP_CORE_CONFIG_DIR="$MISSING_APP_CORE_DIR" run_cli cli register --json || fail "agent-manager cli register exited with status $? (it must be skipped when app-core is not installed)"
assert_contains "agent-manager cli register" "\"status\": \"skipped\"" "$(last_stdout)"
[ ! -e "$MISSING_APP_CORE_DIR" ] || fail "agent-manager cli register created $MISSING_APP_CORE_DIR: a machine without app-core must get no app-core folder"
APP_CORE_CONFIG_DIR="$MISSING_APP_CORE_DIR" run_cli cli unregister --json || fail "agent-manager cli unregister exited with status $?"
echo "ok: nothing was written for a missing app-core"

echo
echo "verify-install: all steps passed for $VERSION on $(uname -s)"
