// violations-suppress: ts/no-barrel-index subpath entry point (package.json exports "./folders"): its exports are the public API consumed by the CLI and the app module
export { FolderError } from './errors.js';
export { MAX_PATH_CHARS, checkAbsolutePath, isFilesystemRoot, isInside, parentOf, pathKey } from './paths.js';
export { LAUNCH_ROOTS_KEY, addLaunchRoot, readLaunchRoots, removeLaunchRoot } from './launchRoots.js';
export type { LaunchRootsChange, LaunchRootsSetting } from './launchRoots.js';
