// Built by `app-core-cli package` into dist-module/dsl-lib/entries.mjs. The default export lists the components the shell registers as
// "agent-manager:<name>" (so the views say `$type: agent-manager:AgentWorkspace`).
import { createRegistry } from '@wadeck-app/dsl-renderer';
import type { ComponentRegistryEntry } from '@wadeck-app/dsl-renderer';
import { AgentWorkspaceEntry, GuardrailsPageEntry, PageNoticesEntry } from './generated/entries.js';

export default Object.values(createRegistry([AgentWorkspaceEntry, GuardrailsPageEntry, PageNoticesEntry])) satisfies ComponentRegistryEntry[];
