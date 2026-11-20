import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const coreSrc = fileURLToPath(new URL('../agent-manager-core/src/', import.meta.url));

export default defineConfig({
  // The tests read the core package from its SOURCES, so `npm test` inside this package works on a fresh checkout, without a prior build of core
  // (its package exports point to dist/). Exact subpaths only: they mirror the "exports" of the core package.json.
  resolve: {
    alias: [
      { find: /^@wadeck-app\/agent-manager-core$/, replacement: `${coreSrc}index.ts` },
      { find: /^@wadeck-app\/agent-manager-core\/launch$/, replacement: `${coreSrc}launch/index.ts` },
      { find: /^@wadeck-app\/agent-manager-core\/reply$/, replacement: `${coreSrc}reply/index.ts` },
      { find: /^@wadeck-app\/agent-manager-core\/transcript$/, replacement: `${coreSrc}transcript/index.ts` },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    restoreMocks: true,
    // Mandatory, shared by every package (see test-support/): the real configuration folder of the developer is redirected to a temp folder before
    // any test code runs, and a run that changes the real folder FAILS.
    globalSetup: ['../../test-support/guardRealConfig.ts'],
    setupFiles: ['../../test-support/isolateEnv.ts'],
    include: ['src/**/*.test.ts'],
    // Timeouts are guards against a test that HANGS, never a performance limit: no test may fail because the machine is slow.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
