/**
 * Builds the module's stylesheet: src/dsl-components/style.css.
 *
 *   npm run css --workspace=packages/app-module-agent-manager
 *
 * `app-core-cli package` copies that file as built (it runs no CSS tool), so this runs first (see the `bundle` script).
 * The file is generated and gitignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import baseTailwind from '../../../tailwind.config.js';
// @ts-expect-error - plain JS preset shipped by dsl-ui, no type declarations
import { dslUiContent } from '@wadeck-app/dsl-ui/tailwind-preset';
import { LIB_CSS, MODULE_STYLE_CSS, SRC_DIR, VIEWS_DIR } from './paths.js';

const toGlob = (p: string): string => p.replaceAll('\\', '/');

/**
 * The utilities the components (and the module's YAML) use. The shell scans only its own sources and dsl-ui, so none of these classes
 * would exist there. dsl-ui is scanned too, exactly as the shell does: the shell loads this sheet after its own, and a utility both define
 * must be ordered the same way (module-authoring.md, "Shipping components").
 */
export async function buildCss(outfile: string = MODULE_STYLE_CSS): Promise<void> {
  const source = fs.readFileSync(LIB_CSS, 'utf8');
  const config = {
    ...baseTailwind,
    content: [
      toGlob(path.join(SRC_DIR, '**', '*.{ts,tsx}')),
      `!${toGlob(path.join(SRC_DIR, '**', '*.test.{ts,tsx}'))}`,
      // The generated entries hold no markup, only wrappers.
      `!${toGlob(path.join(SRC_DIR, 'dsl-components', 'generated', '**'))}`,
      toGlob(path.join(VIEWS_DIR, '*.yaml')),
      ...(dslUiContent as string[]),
    ],
  };
  const result = await postcss([tailwindcss(config), autoprefixer]).process(source, { from: LIB_CSS, to: outfile });
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(outfile, result.css);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await buildCss();
  process.stdout.write(`built ${path.relative(process.cwd(), MODULE_STYLE_CSS)}\n`);
}
