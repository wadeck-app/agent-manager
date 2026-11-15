import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where things are. Kept apart from the build scripts because those import build tools (postcss) that cannot load inside the jsdom test environment. */
export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SRC_DIR = path.join(PACKAGE_DIR, 'src');
const LIB_DIR = path.join(SRC_DIR, 'dsl-components');
/** The components the generated entries wrap: one registered component per file (helpers live in sibling folders, not here). */
export const COMPONENTS_DIR = path.join(LIB_DIR, 'components');
/** Entries generated from COMPONENTS_DIR by build/generate-entries.ts (committed, like any generated source). */
export const LIB_ENTRIES = path.join(LIB_DIR, 'generated', 'entries.tsx');
/** The stylesheet source: what the components need on top of the shell. */
export const LIB_CSS = path.join(LIB_DIR, 'styles', 'agents.css');
export const VIEWS_DIR = path.join(SRC_DIR, 'dsl-views');
/** Where `app-core-cli package` looks for the stylesheet it copies as built (generated, gitignored). */
export const MODULE_STYLE_CSS = path.join(LIB_DIR, 'style.css');
