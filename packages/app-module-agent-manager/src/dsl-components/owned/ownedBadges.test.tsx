import { render, within } from '@testing-library/react';
import { UrlParamContext } from '@wadeck-app/dsl-ui';
import { describe, expect, it } from 'vitest';
import { GroupsList } from '../lists/GroupsList.js';
import { InboxList } from '../lists/InboxList.js';
import { TreeList } from '../lists/TreeList.js';
import type { ListProps } from '../lists/common.js';
import { ownedRow, row } from '../logic/fixtures.js';
import { parseQuery } from '../logic/fuzzy.js';
import { tabCounts } from '../logic/inbox.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { ownedStateChip } from '../logic/owned.js';

const noop = (): void => undefined;
// The Inbox opens on its All tab so every row is listed.
const service = { get: (key: string) => (key === 'tab' ? 'all' : null), set: noop };

function draw(List: (props: ListProps) => React.ReactNode, sessions: ListProps['sessions']) {
  return render(
    <UrlParamContext.Provider value={service}>
      <List sessions={sessions} selectedId={undefined} onSelect={noop} now={2_000_000} query={parseQuery('')} searching={false} options={DEFAULT_VIEW_OPTIONS} />
    </UrlParamContext.Provider>,
  );
}

const sessions = () => [
  row({ folder: 'plain', displayName: 'name-plain', state: 'idle' }),
  ownedRow({ folder: 'web', displayName: 'name-web', state: 'working', ownedState: 'running' }),
  ownedRow({ folder: 'term', displayName: 'name-term', host: 'hc', ownedState: 'unobserved', state: 'idle' }),
  ownedRow({ folder: 'perm', displayName: 'name-perm', state: 'needs-you', status: 'waiting', reason: 'permission prompt', ownedState: 'requires_action', pendingPermissions: 2 }),
  ownedRow({ folder: 'new', displayName: 'name-new', state: 'idle', registryPending: true, ownedState: 'idle', lastActivity: '' }),
];

/** The row of the list whose text holds the name. */
function rowOf(name: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>('[data-session-id]')).find((element) => element.textContent?.includes(name));
  if (found === undefined) {
    throw new Error(`no row for ${name}`);
  }
  return found;
}

describe.each([
  ['Tree', TreeList],
  ['Groups', GroupsList],
  ['Inbox', InboxList],
] as const)('owned badges in the %s list', (_name, List) => {
  it('shows Web / Terminal and the attention states of owned sessions, and nothing on a discovered row', () => {
    draw(List, sessions());
    const plain = rowOf('name-plain');
    expect(plain.querySelector('[data-host-badge]')).toBeNull();
    expect(plain.querySelector('[data-owned-state]')).toBeNull();
    const web = rowOf('name-web');
    expect(web.querySelector('[data-host-badge="stream-json"]')).toHaveTextContent('Web');
    // Running is the spinner state icon of the row already: no second chip in the list.
    expect(web.querySelector('[data-owned-state]')).toBeNull();
    expect(rowOf('name-term').querySelector('[data-host-badge="hc"]')).toHaveTextContent('Terminal');
    expect(within(rowOf('name-perm')).getByText('Waiting for permission (2)')).toBeInTheDocument();
    const starting = rowOf('name-new');
    expect(within(starting).getByText('Starting...')).toBeInTheDocument();
    expect(starting).toHaveTextContent('Starting... no transcript yet');
  });
});

describe('owned state chips', () => {
  it('names the four states of the plan, quiet only for running', () => {
    expect(ownedStateChip(ownedRow({ ownedState: 'running' }))).toMatchObject({ label: 'Running', quiet: true });
    expect(ownedStateChip(ownedRow({ ownedState: 'requires_action', pendingPermissions: 1 }))).toMatchObject({ label: 'Waiting for permission', tone: 'attention', quiet: false });
    expect(ownedStateChip(ownedRow({ ownedState: 'interrupted' }))).toMatchObject({ label: 'Interrupted', quiet: false });
    expect(ownedStateChip(ownedRow({ ownedState: 'exited' }))).toMatchObject({ label: 'Exited', quiet: false });
    expect(ownedStateChip(ownedRow({ ownedState: 'idle' }))).toBeUndefined();
    expect(ownedStateChip(row())).toBeUndefined();
  });

  it('a session waiting for permission counts in the Inbox Needs you tab', () => {
    const counts = tabCounts(sessions());
    expect(counts['needs-you']).toBe(1);
  });
});

describe('the interrupted row in the Tree', () => {
  it('shows the Interrupted chip (the row is kept in the alive list)', () => {
    draw(TreeList, [ownedRow({ folder: 'cut', displayName: 'name-cut', state: 'ended', alive: false, ownedState: 'interrupted' })]);
    expect(within(rowOf('name-cut')).getByText('Interrupted')).toBeInTheDocument();
  });
});

describe('background session chips', () => {
  it('a waiting background session says the terminal answers it, never Allow or Deny', () => {
    const chip = ownedStateChip(ownedRow({ host: 'bg', ownedState: 'requires_action', pendingPermissions: 0 }));
    expect(chip).toMatchObject({ label: 'Waiting in the terminal', tone: 'attention', quiet: false });
    expect(chip?.meaning).toContain('claude attach');
    expect(chip?.meaning).not.toMatch(/Allow|Deny/);
  });

  it('an idle or running background session behaves like the others', () => {
    expect(ownedStateChip(ownedRow({ host: 'bg', ownedState: 'running' }))).toMatchObject({ label: 'Running', quiet: true });
    expect(ownedStateChip(ownedRow({ host: 'bg', ownedState: 'exited' }))).toMatchObject({ label: 'Exited' });
  });
});
