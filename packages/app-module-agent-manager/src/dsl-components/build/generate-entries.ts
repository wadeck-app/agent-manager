/**
 * Generates src/dsl-components/generated/entries.tsx: one registry entry per component of src/dsl-components/components.
 *
 *   npm run entries --workspace=packages/app-module-agent-manager
 *
 * Same generator as any dsl app (dsl-renderer's buildEntriesFile): the JSDoc tags and the prop types of a component are the contract.
 * Only OUR components are scanned (the views use dsl-ui's built-ins from the shell). The file is committed, like any generated source;
 * generateEntries.test.ts fails when it is stale.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEntriesFile } from '@wadeck-app/dsl-renderer/build/entriesGenerator';
import { COMPONENTS_DIR, LIB_ENTRIES, PACKAGE_DIR } from './paths.js';

/**
 * Runs the generator with fs.readdirSync answering in byte order: dsl-renderer never sorts the component files, so the entries would
 * otherwise come out in the file system's order (case-insensitive on Windows, byte order elsewhere) and a file generated on one machine
 * would differ from what CI generates on another.
 */
function withByteOrderListing<T>(run: () => T): T {
  const real = fs.readdirSync;
  fs.readdirSync = ((...args: Parameters<typeof fs.readdirSync>) => {
    const result = (real as (...a: unknown[]) => unknown).apply(fs, args);
    // Only plain name lists: a listing with file types (Dirent) is left as it came.
    return Array.isArray(result) && result.every((entry) => typeof entry === 'string') ? [...result].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : result;
  }) as typeof fs.readdirSync;
  try {
    return run();
  } finally {
    fs.readdirSync = real;
  }
}

/**
 * The generator writes its imports as if the file lived in `<package>/src/generated/` (`../dsl-components/components/X.js`). A module may only hold the
 * folders backend, dsl-views, dsl-components and commons under src (`app-core-cli check`), so the file lives in `src/dsl-components/generated/` and the
 * imports are made relative to there. Fails loudly when the generator's output changes shape, instead of leaving imports that do not resolve.
 */
export function relocateImports(source: string): string {
  const wrong = '../dsl-components/components/';
  if (!source.includes(wrong)) {
    throw new Error(`generate-entries: the generated entries no longer import from '${wrong}'; the generator's output changed, adapt relocateImports.`);
  }
  return source.split(wrong).join('../components/');
}

/** The content of the generated entries file, nothing written. */
export function generateEntries(): string {
  if (!fs.existsSync(COMPONENTS_DIR)) {
    throw new Error(`generate-entries: no components directory at ${COMPONENTS_DIR}.`);
  }
  return relocateImports(withByteOrderListing(() => buildEntriesFile(PACKAGE_DIR, [{ pkg: 'app-module-agent-manager', absDir: COMPONENTS_DIR }], undefined, { usePackageImports: true })));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  fs.mkdirSync(path.dirname(LIB_ENTRIES), { recursive: true });
  fs.writeFileSync(LIB_ENTRIES, generateEntries(), 'utf8');
  process.stdout.write(`generated ${path.relative(process.cwd(), LIB_ENTRIES)}\n`);
}
