#!/usr/bin/env node
import { UpdateManager } from '@wadeck-app/shared-cli';
import { defaultConfigDir } from './configDir.js';
import { getErrorMessage } from './errors.js';
import { showUpdateNotice } from './noticeGlue.js';
import { PACKAGE_NAME, UPDATER_BUNDLE_NAME, ownBundlePath } from './ownBundle.js';
import { run } from './run.js';
import { currentVersion } from './version.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // The updater keeps its state, cache and logs in the config folder of the CLI.
  const configDir = defaultConfigDir(process.env);
  const updates = new UpdateManager(PACKAGE_NAME, configDir);
  showUpdateNotice({
    configDir,
    argv,
    manager: updates,
    print: (line) => process.stderr.write(`${line}\n`),
    warn: (message) => process.stderr.write(`${message}\n`),
  });
  process.exitCode = await run(
    argv,
    {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
    process.env,
    process.cwd(),
  );
  // After every command, a detached background run looks for a newer version (never for a development build, and a no-op in a build without updater bundle).
  updates.scheduleBackgroundUpdate(ownBundlePath(), UPDATER_BUNDLE_NAME, currentVersion());
}

// Anything thrown outside run() (update notice, version lookup, background scheduling) must not end as a raw stack trace.
main().catch((error: unknown) => {
  process.stderr.write(`error: unexpected failure outside a command: ${getErrorMessage(error)}\nPlease report it at https://github.com/wadeck-app/agent-manager/issues\n`);
  process.exit(70);
});
