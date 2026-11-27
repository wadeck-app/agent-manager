import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRow } from '../data/types.js';
import { row } from '../logic/fixtures.js';
import { parseQuery } from '../logic/fuzzy.js';
import { DEFAULT_ROW_LOOK, type RowLook } from '../logic/rowLook.js';
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../logic/viewOptions.js';
import type { ListProps } from './common.js';
import { CustomList } from './CustomList.js';
import { GroupsList } from './GroupsList.js';
import { InboxList } from './InboxList.js';
import { RowLookProvider } from './RowLookContext.js';
import { TreeList } from './TreeList.js';

const NOW = 2_000_000;
const FLAT: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, tree: { grouping: 'none', expansion: 'all' } };
const open = row({ folder: 'alpha', displayName: 'open-one', state: 'idle' });
const quiet = row({ folder: 'bravo', displayName: 'quiet-one', state: 'idle' });
const unread = row({ folder: 'charlie', displayName: 'unread-one', state: 'idle', unread: true });

const LAYOUTS: { name: string; List: (props: ListProps) => ReactNode; options: ViewOptions }[] = [
  { name: 'Tree (by workspace)', List: TreeList, options: DEFAULT_VIEW_OPTIONS },
  { name: 'Tree (flat)', List: TreeList, options: FLAT },
  { name: 'Groups', List: GroupsList, options: DEFAULT_VIEW_OPTIONS },
  { name: 'Inbox', List: InboxList, options: DEFAULT_VIEW_OPTIONS },
  { name: 'Custom', List: CustomList, options: DEFAULT_VIEW_OPTIONS },
];

function show(List: (props: ListProps) => ReactNode, options: ViewOptions, look: RowLook | undefined, sessions: AgentRow[] = [open, quiet, unread]) {
  const service: UrlParamService = { get: () => null, set: () => undefined };
  const list = (
    <UrlParamContext.Provider value={service}>
      <List sessions={sessions} selectedId={open.sessionId.toLowerCase()} onSelect={vi.fn()} now={NOW} query={parseQuery('')} searching={false} options={options} />
    </UrlParamContext.Provider>
  );
  return render(look === undefined ? list : <RowLookProvider look={look} setLook={vi.fn()}>{list}</RowLookProvider>);
}

/** The element that carries the name of the row: the one-line rows write the session name, the two-part labels (Groups, Inbox, flat Tree) the folder first. */
function nameOf(container: HTMLElement, session: AgentRow): HTMLElement {
  const line = container.querySelector<HTMLElement>(`[data-session-id="${session.sessionId.toLowerCase()}"]`);
  if (line === null) {
    throw new Error(`no row for ${session.displayName}`);
  }
  const found = Array.from(line.querySelectorAll<HTMLElement>('span')).find((span) => span.className.includes('truncate') && (span.textContent === session.displayName || span.textContent === session.folder));
  if (found === undefined) {
    throw new Error(`no name element in the row of ${session.displayName}`);
  }
  return found;
}

describe('the row look: the names of the rows, in every layout', () => {
  for (const { name, List, options } of LAYOUTS) {
    describe(name, () => {
      it('default: the open name is not bold and every name has the same color (no grey for an idle agent)', () => {
        const { container } = show(List, options, undefined);
        const names = [open, quiet, unread].map((session) => nameOf(container, session).className);
        for (const classes of names) {
          expect(classes).toContain('text-content');
          expect(classes).not.toContain('text-muted-tint');
        }
        expect(names[0]).toBe(names[1]);
      });

      it('boldActive raises only the open name by one weight step', () => {
        const boxOf = (root: HTMLElement, session: AgentRow): string | undefined => nameOf(root, session).closest('[data-name-box]')?.className;
        const base = show(List, options, DEFAULT_ROW_LOOK);
        const boxBefore = boxOf(base.container, open);
        const before = { open: nameOf(base.container, open).className, quiet: nameOf(base.container, quiet).className };
        base.unmount();
        const { container } = show(List, options, { ...DEFAULT_ROW_LOOK, boldActive: true });
        const after = { open: nameOf(container, open).className, quiet: nameOf(container, quiet).className };
        expect(after.open).not.toBe(before.open);
        expect(after.open).toMatch(/font-(semibold|bold)/);
        expect(after.quiet).toBe(before.quiet);
        // A Herdr row: the bold box takes back the width the weight adds, only for the open name (QA3 R17).
        if (nameOf(container, open).hasAttribute('data-herdr-name')) {
          expect(boxOf(container, open)).toContain('-mr-1.5');
          expect(boxOf(container, quiet)).not.toContain('-mr-1.5');
          expect(boxBefore).not.toContain('-mr-1.5');
        }
      });

      it('dimIdle greys the name of a quiet agent only (not the open one, not the one marked unread)', () => {
        const { container } = show(List, options, { ...DEFAULT_ROW_LOOK, dimIdle: true });
        expect(nameOf(container, quiet).className).toContain('text-muted-tint');
        expect(nameOf(container, open).className).toContain('text-content');
        expect(nameOf(container, unread).className).toContain('text-content');
      });
    });
  }
});

describe('the row look: the state backgrounds and the open row, in every layout', () => {
  const needs = row({ folder: 'delta', displayName: 'needs-one', state: 'needs-you', reason: 'permission prompt' });
  const flagged = row({ folder: 'echo', displayName: 'flag-one', state: 'idle', flagged: true });
  const lineOf = (container: HTMLElement, session: AgentRow): HTMLElement => container.querySelector<HTMLElement>(`[data-session-id="${session.sessionId.toLowerCase()}"]`) as HTMLElement;

  for (const { name, List, options } of LAYOUTS) {
    it(`${name}: a state set to off has no background class; the others keep theirs`, () => {
      const look: RowLook = { ...DEFAULT_ROW_LOOK, needs: 'off' };
      const { container } = show(List, options, look, [needs, flagged, open]);
      const needsLine = container.querySelector<HTMLElement>(`[data-session-id="${needs.sessionId.toLowerCase()}"]`);
      // The Inbox shows one tab at a time: only the rows present are checked.
      if (needsLine !== null) {
        expect(needsLine.className).not.toContain('--am-herdr-needs-bg');
      }
      const flagLine = container.querySelector<HTMLElement>(`[data-session-id="${flagged.sessionId.toLowerCase()}"]`);
      if (flagLine !== null) {
        expect(flagLine.className).toContain('--am-herdr-flag-bg');
      }
    });
  }

  it('Tree: off for needs you falls through to the flag color of a flagged agent that needs you', () => {
    const both = row({ folder: 'foxtrot', displayName: 'both-one', state: 'needs-you', flagged: true, reason: 'permission prompt' });
    const { container } = show(TreeList, FLAT, { ...DEFAULT_ROW_LOOK, needs: 'off' }, [both]);
    expect(lineOf(container, both).className).toContain('--am-herdr-flag-bg');
  });

  it('the open row carries the active edge and image classes in every layout; the variables are what the settings change', () => {
    for (const { List, options } of LAYOUTS) {
      const { container, unmount } = show(List, options, DEFAULT_ROW_LOOK, [open, quiet]);
      expect(lineOf(container, open).className).toContain('--am-herdr-active-bg');
      expect(lineOf(container, quiet).className).not.toContain('--am-herdr-active-bg');
      unmount();
    }
  });

  it('the provider puts the row look on its wrapper as CSS variables (no layout change: the wrapper is display contents)', () => {
    const { container } = show(TreeList, FLAT, { ...DEFAULT_ROW_LOOK, needs: 'purple', focusBg: 'gradient-rtl', focusBar: true, focusOutline: false });
    const wrapper = container.querySelector<HTMLElement>('[data-row-look]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toBe('contents');
    expect(wrapper?.style.getPropertyValue('--am-herdr-needs-bg')).toContain('purple');
    expect(wrapper?.style.getPropertyValue('--am-herdr-active-edge')).toBe('transparent');
    expect(wrapper?.style.getPropertyValue('--am-herdr-active-bg')).toContain('270deg');
  });
});
