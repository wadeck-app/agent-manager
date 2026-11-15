// What the UI takes from src/commons (the contract shared with the backend): one re-export, so the components import it from one level up
// (the violations rule ts/no-deep-relative forbids '../../').
export type * from '../commons/api.js';
export { checkVariant, LIST_STYLES, LOG_STYLES } from '../commons/variants.js';
export type { ListKind, LogStyle, VariantProblem } from '../commons/variants.js';
