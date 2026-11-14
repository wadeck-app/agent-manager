/**
 * Bundles the agent-manager CLI and its updater into self-contained CommonJS files (the shared libraries are inlined).
 * Bundles directly from the TypeScript sources (no prior tsc build required).
 * Output: dist-bundle/agent-manager.cjs, dist-bundle/agent-manager-updater.cjs and dist-bundle/app-module/ (the packaged app-module-agent-manager)
 * Usage:  BUNDLE_VERSION=<version> npx tsx ci/scripts/bundle.ts
 */
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_UPDATER_SIZE = 500 * 1024;

// No default version: a bundle that does not know its version cannot be updated (the updater compares versions).
const version = process.env['BUNDLE_VERSION'];
if (version === undefined || version === '') {
  process.stderr.write('[bundle] ERROR: BUNDLE_VERSION is not set -- refusing to build a bundle without a version (set it, e.g. BUNDLE_VERSION=0.0.0-local)\n');
  process.exit(1);
}

const options = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  external: [],
  supported: { 'top-level-await': false },
  define: { 'import.meta.url': '__importMetaUrl', __AGENT_MANAGER_CLI_VERSION__: JSON.stringify(version) },
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  logLevel: 'warning',
} as const;

const updaterFile = path.join(root, 'dist-bundle/agent-manager-updater.cjs');

await Promise.all([
  build({ ...options, entryPoints: [path.join(root, 'src/main.ts')], outfile: path.join(root, 'dist-bundle/agent-manager.cjs') }),
  build({ ...options, entryPoints: [path.join(root, 'src/agent-manager-updater-entry.ts')], outfile: updaterFile }),
]);

// The app-module is built by its own package: `npm run bundle` there runs `app-core-cli package` (backend bundle, views, packaged
// manifest stamped with BUNDLE_VERSION). Only the resulting dist-module/ is copied next to agent-manager.cjs, where `agent-manager cli register`
// and the updater look for it.
const appModuleDir = path.join(root, '../app-module-agent-manager');
const appModuleOutDir = path.join(root, 'dist-bundle/app-module');
execSync('npm run bundle', { cwd: appModuleDir, env: { ...process.env, BUNDLE_VERSION: version }, stdio: 'inherit', windowsHide: true });
const packagedModule = path.join(appModuleDir, 'dist-module');
if (!existsSync(path.join(packagedModule, 'manifest.json'))) {
  throw new Error(`app-module-agent-manager produced no ${packagedModule}/manifest.json: run "npm run bundle" in packages/app-module-agent-manager and read its output.`);
}
rmSync(appModuleOutDir, { recursive: true, force: true });
cpSync(packagedModule, appModuleOutDir, { recursive: true });

const updaterSize = statSync(updaterFile).size;
if (updaterSize > MAX_UPDATER_SIZE) {
  throw new Error(
    `agent-manager-updater.cjs is ${updaterSize} bytes (${(updaterSize / 1024).toFixed(1)} KB), over the ${MAX_UPDATER_SIZE / 1024} KB limit: ` +
      'the CLI runtime was probably included by accident, check the imports of src/agent-manager-updater-entry.ts',
  );
}

console.log(`Bundled agent-manager.cjs + agent-manager-updater.cjs (${(updaterSize / 1024).toFixed(1)} KB) -- version: ${version}`);
