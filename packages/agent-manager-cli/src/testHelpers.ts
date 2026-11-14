import { getErrorMessage } from './errors.js';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './run.js';

export interface Outcome {
  code: number;
  out: string;
  err: string;
}

export interface Harness {
  configDir: string;
  /** Environment that redirects the config folder, the home and npm into the temporary root, with the automatic update switched off. */
  env: NodeJS.ProcessEnv;
  /** Runs the CLI in-process. */
  cli: (argv: string[], options?: { env?: NodeJS.ProcessEnv }) => Promise<Outcome>;
  cleanup: () => void;
}

/**
 * The environment for a CLI run under test: its own config folder, home, global npm prefix and an unreachable npm registry,
 * with the automatic update switched off. Nothing it starts can reach the real ~/.config/agent-manager or the real global npm.
 */
export function isolatedCliEnv(root: string): NodeJS.ProcessEnv {
  const configDir = join(root, 'config');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.yml'), 'autoUpdate: false\n');
  return {
    ...process.env,
    AGENT_MANAGER_CONFIG_DIR: configDir,
    XDG_CONFIG_HOME: join(root, 'xdg'),
    HOME: join(root, 'home'),
    USERPROFILE: join(root, 'home'),
    // Windows keeps per-user settings (npm, caches) under these: the real ones must not be reachable either.
    ...(process.platform === 'win32' ? { APPDATA: join(root, 'home', 'AppData', 'Roaming'), LOCALAPPDATA: join(root, 'home', 'AppData', 'Local') } : {}),
    npm_config_prefix: join(root, 'npm-prefix'),
    npm_config_registry: 'http://127.0.0.1:9/',
    // A scoped registry in the real .npmrc beats the plain one for @wadeck-app packages: pin the scope too.
    'npm_config_@wadeck-app:registry': 'http://127.0.0.1:9/',
  };
}

/** Test-only (excluded from the build): a real temporary config folder; call cleanup() in afterEach. */
export function makeHarness(): Harness {
  // Real path on purpose: on macOS the temporary directory is a symlink (/var -> /private/var).
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-manager-cli-ws-')));
  const env = isolatedCliEnv(root);
  return {
    configDir: env['AGENT_MANAGER_CONFIG_DIR']!,
    env,
    cli: async (argv, options = {}) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await run(argv, { out: (line) => out.push(line), err: (line) => err.push(line) }, { ...env, ...options.env }, root);
      return { code, out: out.join('\n'), err: err.join('\n') };
    },
    cleanup: () => removeTempDir(root),
  };
}

/**
 * Removes a temp folder at the end of a test. Windows (and antivirus) can refuse for a moment while a handle is still open (EPERM,
 * EBUSY): the removal retries 20 times, 100 ms apart. A folder that still cannot be removed is a warning with its name, never a failed test.
 */
export function removeTempDir(
  dir: string,
  options: { remove?: (path: string, options: { recursive: boolean; force: boolean; maxRetries: number; retryDelay: number }) => void; warn?: (text: string) => void } = {},
): void {
  const { remove = rmSync, warn = (text: string) => void process.stderr.write(text) } = options;
  try {
    remove(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    warn(`[tests] could not remove the temp folder ${dir} (${getErrorMessage(error)}); delete it by hand\n`);
  }
}
