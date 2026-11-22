# Lessons learned (agent-manager)

### A red CI reported as green because of a wrapped exit code

**Problem:** `queue wait ci <sha> ...; echo exit $?` makes the command exit with the code of `echo` (0), so the background-task notification said "exit code 0" while the run had failed; 15 consecutive red runs were reported as green.
**Fix:** Run `queue wait ci <sha> --name agent-manager.ci-<sha7> --cli-foreground` alone in the background (no `;`, no `&&`, no `echo`), read the verdict it prints (`CI FAILED ...` or the passed line) and cross-check the run conclusion with the GitHub Actions API (`actions_list` with `list_workflow_runs`, then `list_workflow_jobs`) before saying "green".
**Context:** A red `build-and-test` skips `publish` and `verify-install`, so the symptom is a published version that stops moving (`npm view @wadeck-app/agent-manager-cli versions --registry=https://npm.pkg.github.com`); check it after every push that should publish.

### Tests that pass on Windows fail on ubuntu and macos in CI

**Problem:** CI runs `vitest run --bail=1` on three OS, so only the first failure per OS is visible, and tests written on Windows assume Windows paths (`//host/share` is UNC only on win32, `C:\home`, `\\host\share`) or an unresolved temp dir (`/var` is `/private/var` on macOS).
**Fix:** Assert platform-dependent behavior per `process.platform` (the POSIX equivalent is asserted elsewhere), resolve temp dirs with `realpath` before comparing paths, and fix production code rather than weakening a test.
**Context:** `--bail=1` hides further failures behind the first one: expect several rounds, or review all path, symlink, case-sensitivity and spawn assumptions of a change before pushing.
