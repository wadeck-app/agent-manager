import * as fs from 'node:fs';
import * as path from 'node:path';
import { getErrorMessage } from './errors.js';
import { readAppModuleVersion } from './registerAfterUpdate.js';

// Imported by the updater bundle (500 KB guard): fs and path only, nothing of the agent-manager runtime.

/** A stamp is a folder name chosen by us (the module version), never a path. */
const STAMP_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Where the staged copies live: `<config folder>/app-module/<version>/`. */
export function stagedModulesRoot(configDir: string): string {
  return path.join(configDir, 'app-module');
}

/**
 * The manifest sits in `<package>/app-module/`: the copy npm installed, which must be staged. A source checkout's
 * `dist-module/` is not (a rebuild keeps the version, so a staged copy would go stale), nor is a staged copy itself
 * (`app-module/<version>/`).
 */
export function isPackagedInstall(manifestPath: string): boolean {
  return path.basename(path.dirname(manifestPath)) === 'app-module';
}

export interface StagedModule {
  /** The manifest to register. */
  manifestPath: string;
  /** The folder name of this copy: the module version. */
  stamp: string;
}

function errorText(err: unknown): string {
  return getErrorMessage(err);
}

/**
 * Copies the module that holds `sourceManifestPath` out of the npm folder into `<configDir>/app-module/<version>/`
 * and returns the manifest to register.
 *
 * app-core stores the PATH of a manifest and reloads from it at its own every start. npm replaces the package folder
 * on every update and deletes it on uninstall, so a path into node_modules dies, and app-core would report a module
 * that cannot load. The copy lives in the config dir, which belongs to the user and not to npm.
 *
 * Once per version: a complete copy is kept. Written beside the target and renamed, so a crash cannot leave a
 * half-copied folder at the path app-core would load from. Throws, naming source and destination, when it cannot.
 */
export function stageAppModule(sourceManifestPath: string, configDir: string): StagedModule {
  const version = readAppModuleVersion(sourceManifestPath);
  if ('absent' in version) {
    throw new Error(
      `Cannot stage the app-module: ${sourceManifestPath} does not exist. Reinstall with: agent-manager cli update`
    );
  }
  if ('error' in version) {
    throw new Error(`Cannot stage the app-module: ${version.error}. Reinstall with: agent-manager cli update`);
  }
  const stamp = version.version;
  if (!STAMP_RE.test(stamp)) {
    throw new Error(
      `Cannot stage the app-module: "${stamp}" (version in ${sourceManifestPath}) is not a usable version stamp (letters, digits, ".", "_" and "-" only, starting with a letter or digit).`
    );
  }
  const sourceDir = path.dirname(sourceManifestPath);
  const target = path.join(stagedModulesRoot(configDir), stamp);
  const manifestPath = path.join(target, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    return { manifestPath, stamp };
  }
  const partial = `${target}.partial-${process.pid}`;
  try {
    fs.rmSync(partial, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(sourceDir, partial, { recursive: true });
    // An incomplete target (no manifest) is debris of an older crash.
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(partial, target);
  } catch (err) {
    fs.rmSync(partial, { recursive: true, force: true });
    // A concurrent run may have finished the same copy first: that one is as good as ours.
    if (fs.existsSync(manifestPath)) {
      return { manifestPath, stamp };
    }
    throw new Error(
      `Cannot stage the app-module from ${sourceDir} into ${target} (${errorText(err)}). It is copied out of the npm folder on purpose, so that updating or removing the package cannot break what app-core remembers. Check that the destination is writable, then run: agent-manager cli register`
    );
  }
  return { manifestPath, stamp };
}

/**
 * Removes the staged copies of every version but `keepStamp`, and returns how many went. A failure to remove one is
 * skipped: the next registration tries again, and a leftover copy costs disk, not correctness.
 */
export function pruneStagedModules(configDir: string, keepStamp: string): number {
  const root = stagedModulesRoot(configDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (entry.name === keepStamp) {
      continue;
    }
    try {
      fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
      removed++;
    } catch {
      // Still in use or locked: left for the next registration.
    }
  }
  return removed;
}

/**
 * True when a copy of the app-module was staged: `agent-manager cli register` did it (and nothing else does), `agent-manager cli unregister`
 * removes it. It is the signal for "the user registered the pages in app-core": an update re-registers only then.
 */
export function hasStagedModule(configDir: string): boolean {
  try {
    return fs
      .readdirSync(stagedModulesRoot(configDir), { withFileTypes: true })
      .some((entry) => entry.isDirectory() && fs.existsSync(path.join(stagedModulesRoot(configDir), entry.name, 'manifest.json')));
  } catch {
    return false;
  }
}

/** Removes every staged copy (and so the signal of hasStagedModule). Nothing to remove is not an error. */
export function removeStagedModules(configDir: string): void {
  fs.rmSync(stagedModulesRoot(configDir), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/**
 * What `cli self-check` asks when the user registered the module (a staged copy exists): every staged manifest is readable JSON, has the module id
 * and a version equal to the name of its folder (the stamp). Returns a sentence for the log; throws, naming the file and the fix, otherwise.
 * Not registered is not a failure: there is nothing to check.
 */
export function checkStagedModules(configDir: string, expectedId: string): string {
  if (!hasStagedModule(configDir)) {
    return 'the app-module is not registered: no staged copy to check';
  }
  const root = stagedModulesRoot(configDir);
  const checked: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const manifestPath = path.join(root, entry.name, 'manifest.json');
    if (!entry.isDirectory() || !fs.existsSync(manifestPath)) {
      continue;
    }
    let manifest: { id?: unknown; version?: unknown };
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { id?: unknown; version?: unknown };
    } catch (err) {
      throw new Error(`the staged app-module manifest ${manifestPath} cannot be read (${errorText(err)}); run: agent-manager cli register`);
    }
    if (manifest.id !== expectedId || manifest.version !== entry.name) {
      throw new Error(
        `the staged app-module manifest ${manifestPath} has id ${JSON.stringify(manifest.id)} and version ${JSON.stringify(manifest.version)}, expected id ${JSON.stringify(expectedId)} and version ${JSON.stringify(entry.name)}; run: agent-manager cli register`
      );
    }
    checked.push(entry.name);
  }
  return `staged app-module readable (${checked.join(', ')})`;
}
