// What the UI takes from src/commons (the contract shared with the backend): one re-export, so the components import it from one level up
// (the violations rule ts/no-deep-relative forbids '../../').
export type * from '../commons/api.js';
export type * from '../commons/guardrails.js';
export { GRANT_MODES, MAX_BATCH_GRANT_SESSIONS, MAX_BATCH_REVOKE_ITEMS, MAX_RATIONALE_CHARS } from '../commons/guardrails.js';
export { BATCH_CONCURRENCY, MAX_BATCH_RECIPIENTS } from '../commons/batch.js';
export { DEFAULT_MODE, isMode, MODE_LABEL, MODES } from '../commons/variants.js';
export type { ModeId } from '../commons/variants.js';
export { CSRF_HEADER, CSRF_PATH } from '../commons/csrf.js';
export { isSensitiveRequest } from '../commons/routeClasses.js';
export { FORK_NAME_MAX, forkNameOf, threadNameOf } from '../commons/forkName.js';
export { checkGroupName, GROUP_COLORS, GROUP_NAME_MAX, GROUP_SORTS, placeMember } from '../commons/groups.js';
export type { GroupColor, GroupSort } from '../commons/groups.js';
