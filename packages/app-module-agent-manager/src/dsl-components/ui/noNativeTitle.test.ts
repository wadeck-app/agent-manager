// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_DIR } from '../build/paths.js';

/** The components of the dsl-ui that render a button: a `title` on them would be a second, browser made tooltip (the label of an IconButton is already its tooltip). */
const BUTTONS = new Set(['IconButton', 'ButtonAction', 'TabButton', 'ChipButton', 'RefreshButton', 'DeleteButton']);
/** The one file that passes an empty title on purpose, to switch the dsl-ui IconButton tooltip off around its own (ui/TipIconButton.tsx says why). */
const ALLOWED = path.join('ui', 'TipIconButton.tsx');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sourceFiles(full);
    }
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });
}

/**
 * The tag a `title=` attribute belongs to: walk back from it to the nearest `<Tag` that is not inside a `{...}` expression of an earlier attribute (those are skipped
 * by counting braces). The TypeScript compiler API is not used: the installed typescript has no JavaScript API.
 */
function tagOf(text: string, at: number): string | undefined {
  let depth = 0;
  for (let index = at - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === '}') {
      depth += 1;
    } else if (char === '{') {
      depth -= 1;
      if (depth < 0) {
        // Inside the value of a prop of an outer element (a `title=` inside `icon={<X title=... />}` is looked at from its own tag): not an attribute of a tag.
        return undefined;
      }
    } else if (char === '<' && depth === 0 && /[A-Za-z]/.test(text[index + 1] ?? '')) {
      return /^[A-Za-z][\w.]*/.exec(text.slice(index + 1))?.[0];
    }
  }
  return undefined;
}

/** Every `title` attribute passed to a native element (lower case tag) or to a dsl-ui button, as `file:line <Tag>`. */
function nativeTitles(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of text.matchAll(/\stitle=/g)) {
    const tag = tagOf(text, match.index);
    if (tag !== undefined && (/^[a-z]/.test(tag) || BUTTONS.has(tag))) {
      found.push(`${path.relative(SRC_DIR, file)}:${text.slice(0, match.index).split('\n').length} <${tag}>`);
    }
  }
  return found;
}

describe('no native title in the module', () => {
  it('no component passes a native `title` to a native element or to a dsl-ui button (the tooltip of the dsl-ui is the one hint; the label of an IconButton is already its tooltip)', () => {
    const files = sourceFiles(path.join(SRC_DIR, 'dsl-components'));
    expect(files.length).toBeGreaterThan(100);
    const all = files.filter((file) => !file.endsWith(ALLOWED)).flatMap(nativeTitles);
    expect(all, 'use <Tooltip> (or TipIconButton when the tip is longer than the name of an icon button): a native title is a second, unstyled tooltip').toEqual([]);
  });

  it('the checker sees a title on a native element and on a button (it is not blind)', () => {
    const sample = '<div className="x">\n<IconButton size="icon" aria-label="a" title="b" />\n<span\n  title={`c`}>t</span>\n<Modal title="m" /></div>';
    const tags = [...sample.matchAll(/\stitle=/g)].map((match) => tagOf(sample, match.index));
    expect(tags).toEqual(['IconButton', 'span', 'Modal']);
  });

  it('the one allowed file really passes an empty title only', () => {
    const file = path.join(SRC_DIR, 'dsl-components', ALLOWED);
    expect(nativeTitles(file)).toHaveLength(1);
    expect(fs.readFileSync(file, 'utf8')).toContain('title=""');
  });
});
