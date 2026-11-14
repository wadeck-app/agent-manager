#!/usr/bin/env bash
# Copies the Go launcher binaries, the esbuild bundles, the packaged app-module and the README into the generated platform packages and dist package.
# Run after generate-platform-packages.sh, from the repository root:
#   bash packages/agent-manager-cli/ci/scripts/copy-binaries.sh
set -euo pipefail

LAUNCHER_DIST="packages/agent-manager-cli/launcher-go/dist"
BUNDLE_DIST="packages/agent-manager-cli/dist-bundle"

cp "$LAUNCHER_DIST/agent-manager_windows_release.exe" packages/agent-manager-cli-win32-x64/agent-manager.exe
cp "$LAUNCHER_DIST/agent-manager_darwin_arm64_release" packages/agent-manager-cli-darwin-arm64/agent-manager
cp "$LAUNCHER_DIST/agent-manager_linux_amd64_release" packages/agent-manager-cli-linux-x64/agent-manager
chmod +x packages/agent-manager-cli-darwin-arm64/agent-manager packages/agent-manager-cli-linux-x64/agent-manager
cp "$BUNDLE_DIST/agent-manager.cjs" packages/agent-manager-cli-dist/agent-manager.cjs
cp "$BUNDLE_DIST/agent-manager-updater.cjs" packages/agent-manager-cli-dist/agent-manager-updater.cjs
cp -r "$BUNDLE_DIST/app-module" packages/agent-manager-cli-dist/app-module
cp packages/agent-manager-cli/README.md packages/agent-manager-cli-dist/README.md
echo "agent-manager artifacts copied"
