// Entry point of the updater, bundled separately as agent-manager-updater.cjs. It must NOT import the CLI runtime (size limit, see ci/scripts/bundle.ts).
import { realUpdaterDeps, updaterConfigDir } from './updater/realDeps.js';
import { runAgentManagerUpdater } from './updater/runAgentManagerUpdater.js';

// Injected by esbuild (define) in ci/scripts/bundle.ts; the updater is only ever built that way.
declare const __AGENT_MANAGER_CLI_VERSION__: string | undefined;

if (typeof __AGENT_MANAGER_CLI_VERSION__ !== 'string' || __AGENT_MANAGER_CLI_VERSION__ === '') {
  process.stderr.write('[agent-manager-updater] fatal: this updater was built without a version (BUNDLE_VERSION); rebuild it with: npm run bundle\n');
  process.exit(1);
}

runAgentManagerUpdater(realUpdaterDeps(process.env, updaterConfigDir(process.env), __AGENT_MANAGER_CLI_VERSION__)).then((code) => {
  process.exitCode = code;
});
