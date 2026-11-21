// What the UI takes from src/commons (the contract shared with the backend): one re-export, so the components import it from one level up
// (the violations rule ts/no-deep-relative forbids '../../').
export type * from '../commons/api.js';
export type * from '../commons/guardrails.js';
export { DEFAULT_MODE, isMode, MODE_LABEL, MODES } from '../commons/variants.js';
export type { ModeId } from '../commons/variants.js';
export { CSRF_HEADER, CSRF_PATH } from '../commons/csrf.js';
export { isSensitiveRequest } from '../commons/routeClasses.js';
