import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const coreSrc = fileURLToPath(new URL('../agent-manager-core/src/', import.meta.url));

// The tests read the core package from its SOURCES, so `npm test` inside this package works on a fresh checkout, without a prior build of core
// (its package exports point to dist/). Exact subpaths only: they mirror the "exports" of the core package.json.
const alias = [
  { find: /^@wadeck-app\/agent-manager-core$/, replacement: `${coreSrc}index.ts` },
  { find: /^@wadeck-app\/agent-manager-core\/folders$/, replacement: `${coreSrc}folders/index.ts` },
  { find: /^@wadeck-app\/agent-manager-core\/launch$/, replacement: `${coreSrc}launch/index.ts` },
  { find: /^@wadeck-app\/agent-manager-core\/reply$/, replacement: `${coreSrc}reply/index.ts` },
  { find: /^@wadeck-app\/agent-manager-core\/transcript$/, replacement: `${coreSrc}transcript/index.ts` },
];

// Timeouts are guards against a test that HANGS, never a performance limit: no test may fail because the machine is slow
// (a Windows CI runner is several times slower than a laptop for file and process work).
const timeouts = { testTimeout: 300_000, hookTimeout: 300_000 };

/*
 * Two suites with different needs:
 *  - backend: the routes and the packaging checks, plain Node. The shared isolation (test-support/) redirects the real configuration folder of the developer
 *    to a temp folder before any test code runs, and a run that changes the real folder FAILS.
 *  - ui: the React components and their pure logic (src/dsl-components), jsdom. Same isolation, so no test can touch the real folders either.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'backend',
          root: import.meta.dirname,
          globals: true,
          environment: 'node',
          restoreMocks: true,
          globalSetup: ['../../test-support/guardRealConfig.ts'],
          // vitest.setup.ts: this module's own sandbox on top of the shared one (a registry folder for app-core-cli dev).
          setupFiles: ['../../test-support/isolateEnv.ts', './src/backend/vitest.setup.ts'],
          include: ['src/backend/**/*.test.ts', 'src/commons/**/*.test.ts'],
          ...timeouts,
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'ui',
          root: import.meta.dirname,
          globals: true,
          environment: 'jsdom',
          restoreMocks: true,
          globalSetup: ['../../test-support/guardRealConfig.ts'],
          setupFiles: ['../../test-support/isolateEnv.ts', './src/dsl-components/test-setup.ts'],
          include: ['src/dsl-components/**/*.test.{ts,tsx}'],
          ...timeouts,
        },
      },
    ],
  },
});
