// violations-suppress: ts/no-barrel-index package entry point (package.json main/types): its exports are the package's public API consumed by app-module-agent-manager
// Public barrel for @wadeck-app/agent-manager-core.
export { getErrorMessage } from './errors.js';
export { isPidAlive } from './pidAlive.js';
export { lastDirectory } from './folder.js';
export { readSessionRegistry, sortByStatusUpdatedDesc } from './readSessionRegistry.js';
export type { ReadOptions } from './readSessionRegistry.js';
export { SESSIONS_DIR_ENV, resolveSessionsDir } from './sessionsDir.js';
export type { LivenessCheck, RegistryError, RegistryErrorCode, RegistryResult, Session, StatusGroup, UnreadableFile } from './session.js';
