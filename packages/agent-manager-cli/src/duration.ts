// The parser lives in the core package (the reply side needs it too); this module keeps the import path of the CLI stable.
// The core package root exports parseDuration and DurationError. At build time the core package must be built first (root `npm run build` does it);
// the tests read the core sources through the alias of vitest.config.ts, so they need no prior build.
export { DurationError, parseDuration } from '@wadeck-app/agent-manager-core';
