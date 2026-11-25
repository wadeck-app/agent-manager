// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postcss, { type AtRule, type Container, type Rule } from 'postcss';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCss } from './build-css.js';
import { SRC_DIR } from './paths.js';
import { DENSITY_SCALE, SCALE_VARIABLES } from '../ui/densityScale.js';

/**
 * The shell loads the stylesheet of every module, each a full Tailwind build: an unscoped `.hidden{display:none}` of a later module beats our
 * `@media{.lg\:flex{display:flex}}`. build-css.ts scopes every utility under `.agents-scope` (specificity 0,2,0), and ui/Scope.tsx puts the class on every root.
 */
const SCOPE = '.agents-scope';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-css-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Every style rule of the sheet with its at-rule ancestry, keyframe steps excluded (their selectors are `from`, `50%`). */
function rules(root: Container): { rule: Rule; at: string[] }[] {
  const found: { rule: Rule; at: string[] }[] = [];
  const walk = (node: Container, at: string[]): void => {
    node.each((child) => {
      if (child.type === 'rule') {
        found.push({ rule: child, at });
      } else if (child.type === 'atrule') {
        const atRule = child as AtRule;
        if (!/keyframes$/i.test(atRule.name)) {
          walk(atRule, [...at, `@${atRule.name} ${atRule.params}`]);
        }
      }
    });
  };
  walk(root, []);
  return found;
}

describe('the module stylesheet', () => {
  const outfile = path.join(tmp, 'style.css');
  const parsed = (async () => {
    await buildCss(outfile);
    return postcss.parse(fs.readFileSync(outfile, 'utf8'));
  })();

  it('has every rule under the scope selector (only the wrapper rule is the bare scope)', async () => {
    const all = rules(await parsed);
    expect(all.length).toBeGreaterThan(100);
    // The wrapper's own attribute rules: the density scale.
    const unscoped = all.flatMap(({ rule }) => rule.selectors).filter((selector) => selector !== SCOPE && !/^\.agents-scope\[data-density='(?:s|m|ml|l)'\]$/.test(selector) && !selector.startsWith(`${SCOPE} `));
    expect(unscoped, 'rules outside the scope leak into the other modules (and lose to theirs); see build-css.ts').toEqual([]);
  });

  it('defines the type and icon scale per density, none of them below 12 px, and the type steps read it', async () => {
    const root = await parsed;
    const sizes: Record<string, Record<string, number>> = {};
    root.walkRules((rule) => {
      const match = /^\.agents-scope\[data-density='(s|ml|l)'\]$/.exec(rule.selector);
      if (match?.[1] === undefined) {
        return;
      }
      const vars: Record<string, number> = {};
      rule.walkDecls(/^--am-fs-/, (decl) => {
        vars[decl.prop] = Number.parseFloat(decl.value);
      });
      sizes[match[1]] = vars;
    });
    expect(Object.keys(sizes).sort()).toEqual(['l', 'ml', 's']);
    for (const vars of Object.values(sizes)) {
      for (const [name, px] of Object.entries(vars)) {
        expect(px, name).toBeGreaterThanOrEqual(12);
      }
    }
    // M is the default and sits on the bare scope rule.
    const css = root.toString();
    expect(css).toMatch(/\.agents-scope,\s*\.agents-scope\[data-density='m'\]\s*\{[^}]*--am-fs-sm: 15px/);
    expect(css).toMatch(/\.agents-scope \.text-sm\s*\{\s*font-size: var\(--am-fs-sm\)/);
    expect(css).toMatch(/\.agents-scope \.text-am-mono\s*\{\s*font-size: var\(--am-fs-mono\)/);
  });

  it('holds exactly the sizes of ui/densityScale.ts (the source of the popover hints) for every density', async () => {
    const root = await parsed;
    for (const density of ['s', 'm', 'ml', 'l'] as const) {
      const selector = density === 'm' ? new Set([SCOPE, `${SCOPE}[data-density='m']`]) : new Set([`${SCOPE}[data-density='${density}']`]);
      const found: Record<string, number> = {};
      root.walkRules((rule) => {
        if (rule.selectors.some((one) => selector.has(one))) {
          rule.walkDecls(/^--am-(fs|icon|dot|hit|row|aside|log-max)/, (decl) => {
            found[decl.prop] = Number.parseFloat(decl.value);
          });
        }
      });
      const expected = Object.fromEntries(Object.entries(DENSITY_SCALE[density]).map(([key, px]) => [SCALE_VARIABLES[key as keyof typeof SCALE_VARIABLES], px]));
      expect(found, density).toEqual(expected);
    }
  });

  it('keeps the responsive override inside the scope, so it beats another module .hidden', async () => {
    const all = rules(await parsed);
    const hidden = all.find(({ rule, at }) => at.length === 0 && rule.selector === `${SCOPE} .hidden`);
    const lgFlex = all.find(({ rule, at }) => rule.selector === `${SCOPE} .lg\\:flex` && at.some((a) => a.includes('min-width: 1024px')));
    expect(hidden, 'the scoped .hidden rule is missing').toBeDefined();
    expect(lgFlex, 'the scoped lg:flex rule is missing').toBeDefined();
  });

  it('keeps the dark variant working (the .dark ancestor is outside the scope, so it must stay a condition on the element)', async () => {
    const dark = rules(await parsed).filter(({ rule }) => rule.selector.includes('.dark *'));
    expect(dark.length).toBeGreaterThan(0);
    expect(dark.every(({ rule }) => /^\.agents-scope \.[^ ]+:is\(\.dark \*\)$/.test(rule.selector))).toBe(true);
  });

  it('declares the wrapper as display: contents, so the scope adds no box', async () => {
    const wrapper = rules(await parsed).find(({ rule }) => rule.selector === SCOPE);
    expect(wrapper?.rule.nodes.map((node) => node.toString())).toEqual(['display: contents']);
  });

  it('emits no .container component', async () => {
    expect(rules(await parsed).some(({ rule }) => rule.selector.includes('container'))).toBe(false);
  });
});

describe('portals', () => {
  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? sources(full) : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  it('every createPortal call wraps its content in <Scope> (a portal renders outside the scoped root)', () => {
    const offenders = sources(SRC_DIR).filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return /createPortal\(/.test(text) && !/createPortal\(\s*<Scope>/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
