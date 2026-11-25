import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRow } from '../data/types.js';
import { row } from '../logic/fixtures.js';
import { parseQuery } from '../logic/fuzzy.js';
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../logic/viewOptions.js';
import type { ListProps } from './common.js';
import { CustomList } from './CustomList.js';
import { TreeList } from './TreeList.js';

const NOW = 2_000_000;
const ON: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, subagents: { show: true } };

function Harness({ sessions, List, options }: { sessions: AgentRow[]; List: (props: ListProps) => React.ReactNode; options: ViewOptions }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const service: UrlParamService = { get: () => null, set: () => undefined };
  return (
    <UrlParamContext.Provider value={service}>
      <List sessions={sessions} selectedId={selected} onSelect={setSelected} now={NOW} query={parseQuery('')} searching={false} options={options} />
    </UrlParamContext.Provider>
  );
}

const parent = row({ folder: 'shop', cwd: '/a/shop', displayName: 'parent', state: 'needs-you', subagentCount: 3 });
const plain = row({ folder: 'shop', cwd: '/a/shop', displayName: 'plain', state: 'idle' });

// With the option on, EVERY agent row holds a chevron slot (Herdr rows), a chevron or a same-size placeholder (compact Tree rows): same left offset for all.
function rowsWithoutLeadingSlot(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-session-id]'))
    .filter((item) => item.querySelector('[data-row-chevron-slot], span.h-7.w-7, button[aria-label*="sub-agents"]') === null)
    .map((item) => item.dataset['sessionId'] ?? '');
}

function stubSubagents(): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, entries: [], subagents: [], subagentsNote: '' }) }));
}

describe('TreeList keyboard with the option on', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ArrowRight opens and ArrowLeft closes the sub-agents of the focused agent', () => {
    stubSubagents();
    const { container } = render(<Harness sessions={[parent, plain]} List={TreeList} options={ON} />);
    const target = container.querySelector<HTMLElement>(`[data-session-id="${parent.sessionId.toLowerCase()}"]`)!;
    fireEvent.keyDown(target, { key: 'ArrowRight' });
    expect(target.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(target, { key: 'ArrowLeft' });
    expect(target.getAttribute('aria-expanded')).toBe('false');
  });
});

describe.each([
  ['TreeList', TreeList],
  ['CustomList', CustomList],
])('%s with the sub-agents option', (_name, List) => {
  afterEach(() => vi.unstubAllGlobals());

  it('off (default): no chevron, no sub-agent request, no aria-expanded on a row, the count chip stays, no reserved slot', () => {
    stubSubagents();
    const { container } = render(<Harness sessions={[parent, plain]} List={List} options={DEFAULT_VIEW_OPTIONS} />);
    expect(screen.queryByRole('button', { name: /sub-agents/ })).toBeNull();
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-session-id]'));
    expect(rows).toHaveLength(2);
    // The only expandable items are folders (Tree): never an agent row.
    expect(rows.every((item) => !item.hasAttribute('aria-expanded'))).toBe(true);
    expect(container.querySelector('[data-row-chevron-slot], span.h-7.w-7:not([data-status-column])')).toBeNull();
    // The count chip costs no vertical room and is kept.
    expect(screen.getByLabelText('3 sub-agents')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('off: ArrowRight on an agent with sub-agents opens nothing and requests nothing', () => {
    stubSubagents();
    const { container } = render(<Harness sessions={[parent, plain]} List={List} options={DEFAULT_VIEW_OPTIONS} />);
    const target = container.querySelector<HTMLElement>(`[data-session-id="${parent.sessionId.toLowerCase()}"]`)!;
    fireEvent.keyDown(target, { key: 'ArrowRight' });
    expect(target.hasAttribute('aria-expanded')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('on: the chevron exists on the agent with sub-agents, the slot is reserved on every row, aria-expanded is set, ArrowRight opens', () => {
    stubSubagents();
    const { container } = render(<Harness sessions={[parent, plain]} List={List} options={ON} />);
    expect(screen.getByRole('button', { name: 'Show the 3 sub-agents' })).toBeInTheDocument();
    expect(rowsWithoutLeadingSlot(container)).toEqual([]);
    const target = container.querySelector<HTMLElement>(`[data-session-id="${parent.sessionId.toLowerCase()}"]`)!;
    expect(target.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Show the 3 sub-agents' }));
    expect(target.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Hide the 3 sub-agents' })).toBeInTheDocument();
  });

});
