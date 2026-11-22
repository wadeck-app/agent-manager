/**
 * Where the w-guardrails plugin (v1.29.0) keeps its files. The one place that names them: the readers and the tests import these constants.
 * The module only reads these files (phase 1 of the Guardrails page). Folder of a project: <cwd>/.claude/w-guardrails.
 */
export const PLUGIN_STATE_DIR = 'w-guardrails';

/** The bypasses the user granted: { overrides: [...] }. */
export const GRANTS_FILE = 'guardrails.bypass.json';

/** The per-session counters: { requests: { <sessionId>: {...} } }. */
export const COUNTERS_FILE = 'bypass-state.json';

/** The project rules, next to the plugin folder: <cwd>/.claude/guardrails.json. */
export const RULES_FILE = 'guardrails.json';

/** The kill switch: <home>/.claude/w-guardrails/DISABLED (the file exists = every protection is off). */
export const KILL_SWITCH_FILE = 'DISABLED';

/** The blocked journal: <home>/.claude/logs/w-guardrails/w-guardrails-blocked-<YYYY-MM-DD>.jsonl. */
export const JOURNAL_DIR_PARTS = ['.claude', 'logs', 'w-guardrails'] as const;
export const JOURNAL_PREFIX = 'w-guardrails-blocked-';
export const JOURNAL_SUFFIX = '.jsonl';

/** The shape version of those files this module knows (w-guardrails 1.29.0 writes a `schema` tag in them, see the schema constants below; older files have none). A change of shape is refused, see guardrailsFiles.ts. */
export const FORMAT_VERSION = 1;

/** The grants file above this size is ignored by the hook, so the module reports it instead of listing it. */
export const MAX_GRANTS_BYTES = 65_536;
/** The plugin has no limit for the other two; the module refuses a file this big instead of loading it. */
export const MAX_OTHER_BYTES = 1_048_576;

/** The schema tags of the plugin (README "State files, journals and schemas"): `"<id>/<version>"`, first key of a file or of a journal record. A missing tag is version 1. */
export const GRANTS_SCHEMA = 'w-guardrails.bypass-state/1';
export const COUNTERS_SCHEMA = 'w-guardrails.spam-state/1';
export const BLOCKED_SCHEMA = 'w-guardrails.blocked/1';
