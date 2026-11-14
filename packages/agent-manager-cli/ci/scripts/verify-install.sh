#!/usr/bin/env bash
# Verifies, in an isolated temp environment, that a published version of @wadeck-app/agent-manager-cli installs and works.
#
# Usage:       bash packages/agent-manager-cli/ci/scripts/verify-install.sh <version>
# Run locally: needs bash (git-bash on Windows), node >= 22, npm configured for GitHub Packages
#              (@wadeck-app:registry=https://npm.pkg.github.com and a token with read:packages).
#              Nothing outside a temp folder is touched: the global npm prefix, the config folder and the home are redirected.
# M1 skeleton: step (d) asserts that the daemon commands FAIL explicitly. Replace it with a real smoke test when the daemon exists.
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

step "(d) the daemon commands are not implemented in the M1 skeleton: they must fail explicitly, never succeed"
for command in stop status; do
  if run_cli "$command"; then
    fail "agent-manager $command exited 0: it must fail with 'daemon not implemented yet'"
  fi
  assert_contains "agent-manager $command" "daemon not implemented yet (planned M1b)" "$(last_stderr)"
done
# `start` goes through the Go launcher of the platform package, which supervises the node process: only the exit code is asserted (the wording of the launcher is not under our control).
if run_cli start; then
  fail "agent-manager start exited 0: it must fail, the daemon is not implemented"
fi
echo "ok: agent-manager start failed as expected"

step "(e) cli register fails explicitly (there is no app-module yet)"
if run_cli cli register; then
  fail "agent-manager cli register exited 0: it must fail with 'app-core module not implemented yet'"
fi
assert_contains "agent-manager cli register" "app-core module not implemented yet (planned M1b)" "$(last_stderr)"

echo
echo "verify-install: all steps passed for $VERSION on $(uname -s)"
