// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postcss, { type AtRule, type Container, type Rule } from 'postcss';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCss } from './build-css.js';
import { SRC_DIR } from './paths.js';

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
    const unscoped = all.flatMap(({ rule }) => rule.selectors).filter((selector) => selector !== SCOPE && !selector.startsWith(`${SCOPE} `));
    expect(unscoped, 'rules outside the scope leak into the other modules (and lose to theirs); see build-css.ts').toEqual([]);
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
