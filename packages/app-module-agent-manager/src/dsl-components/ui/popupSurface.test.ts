// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { POPUP_BG, POPUP_BORDER, POPUP_DIVIDER, POPUP_SECTION, POPUP_SHADOW, POPUP_SURFACE } from './popupSurface.js';

/** The class form of a CSS value: spaces are underscores. */
const asClass = (value: string): string => value.replaceAll(', ', ',').replaceAll(' / ', '/').replaceAll(' ', '_');

describe('the popup surface', () => {
  it('says in its classes what its constants say (the classes are written in full, so they cannot be built from the constants)', () => {
    expect(POPUP_SURFACE).toContain(`border-[color:${asClass(POPUP_BORDER)}]`);
    expect(POPUP_SURFACE).toContain(`bg-[color:${asClass(POPUP_BG)}]`);
    expect(POPUP_SURFACE).toContain(`shadow-[${asClass(POPUP_SHADOW)}]`);
    expect(POPUP_SECTION).toContain(`border-[color:${asClass(POPUP_DIVIDER)}]`);
  });

  it('is opaque: no alpha channel in the border or the surface', () => {
    for (const value of [POPUP_BORDER, POPUP_BG]) {
      expect(value).not.toMatch(/transparent|\/\s*0\./);
    }
  });

  it('the rule of styles/agents.css for the portaled library menu uses the same values', () => {
    const css = fs.readFileSync(path.join(import.meta.dirname, '..', 'styles', 'agents.css'), 'utf8');
    const rule = css.slice(css.indexOf("[data-testid='context-menu-content']:has([data-am-menu]) {"));
    for (const value of [POPUP_BORDER, POPUP_BG, POPUP_SHADOW, POPUP_DIVIDER]) {
      expect(rule).toContain(value);
    }
  });
});
