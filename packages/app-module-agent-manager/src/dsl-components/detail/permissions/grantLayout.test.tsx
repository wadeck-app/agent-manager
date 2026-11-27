import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// violations-suppress: ts/no-deep-relative test fixtures of the logic folder
import { overview } from '../../logic/permissionsFixtures.js';
// violations-suppress: ts/no-deep-relative test fixtures of the owned folder
import { stubFetch } from '../../owned/testFetch.js';

import { permissionsOf, row } from '../deps.js';
import type { CliGrantDto, SessionGrantsDto } from '../deps.js';
import { PermissionsPanel } from './PermissionsPanel.js';
import { SECTION, SECTION_BODY } from './sectionSpacing.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const SID = '00000000-0000-4000-8000-000000000001';
const session = row({ sessionId: SID, cwd: '/w/shop' });
const EXPIRY = Date.now() + 600_000;
const grant = (id: string, category: string, over: Partial<CliGrantDto> = {}): CliGrantDto => ({ id, category, mode: 'ttl', sessionId: SID, expiresAt: EXPIRY, remainingMs: 600_000, remainingText: '10 min', usesLeft: null, reason: 'clean the build folder', origin: null, ...over });
const data = (grants: CliGrantDto[]): SessionGrantsDto => ({ ok: true, code: '', sessionId: SID, cwd: '/w/shop', cwdNote: '', grants, errorText: '' });
const CSRF = { 'GET /csrf': { body: { header: 'x-agent-manager-csrf', token: 't' } } };
const revoked = (id: string, category: string) => ({ body: { ok: true, id, category, sessionId: SID, cwd: '/w/shop', auditError: '' } });

function renderWith(grants: CliGrantDto[]) {
  const files = overview([]);
  return render(<PermissionsPanel session={session} feed={{ overview: files, view: permissionsOf(files, SID, session.cwd), error: '', loading: false, reload: vi.fn(), cli: { kind: 'ok', data: data(grants) } }} />);
}

/** The closest element that holds both nodes. */
function commonAncestor(a: Element, b: Element): Element {
  let node: Element | null = a;
  while (node !== null && !node.contains(b)) {
    node = node.parentElement;
  }
  if (node === null) {
    throw new Error('no common ancestor');
  }
  return node;
}

// jsdom has no layout: the structure is what can be pinned. The title and the trash icon must share one line (a wrapper that is not the row itself).
describe('the bypass row (the table is the only rendering)', () => {
  it('shows the facts and offers the revoke: the trash icon sits on the line of the title, with its accessible name', () => {
    renderWith([grant('a1b2c3d4', 'rm', { usesLeft: 1, mode: 'once' })]);
    const item = screen.getByRole('region', { name: 'This session' }).querySelector('[data-cli-grant="a1b2c3d4"]') as HTMLElement;
    expect(item.closest('[data-grant-rows]')).not.toBeNull();
    const revoke = within(item).getByRole('button', { name: 'Revoke the rm bypass' });
    const title = within(item).getAllByText('rm')[0] as HTMLElement;
    // The line of the title is a wrapper inside the row, not the row: the icon is not on a line of its own under the text.
    expect(commonAncestor(title, revoke)).not.toBe(item);
    // The table: three fixed columns (category, time left, trash) so that the times line up.
    expect(item.querySelector('.grid')?.className).toContain('grid-cols-[minmax(0,1fr)_6.5rem_1.75rem]');
    expect(item.querySelector('[data-grant-left]')).toHaveTextContent('10 min left');
    expect(item).not.toHaveTextContent('no use limit');
    expect(item).not.toHaveTextContent('full id');
  });

  it('two bypasses that share their reason and expiry stay two rows, each with its own revoke (no group)', () => {
    const reason = 'ship the fix';
    renderWith([grant('a1b2c3d4', 'git-commit', { reason }), grant('b2c3d4e5', 'git-push', { reason })]);
    const items = document.querySelectorAll('[data-grant-row]');
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(within(item as HTMLElement).getAllByRole('button', { name: /^Revoke/ })).toHaveLength(1);
    }
    expect(screen.queryByRole('button', { name: /bypasses:/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /bypass details/ })).toBeNull();
  });

  it('Revoke asks first, then sends the PIN-gated request for this bypass only', async () => {
    const { calls } = stubFetch({ ...CSRF, 'POST /guardrails/grants/a1b2c3d4/revoke': revoked('a1b2c3d4', 'rm') });
    renderWith([grant('a1b2c3d4', 'rm')]);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the rm bypass' }));
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(screen.getByText('Revoke the rm bypass (10 min left)? The guardrail applies again to this session at once.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Revoked the rm bypass (a1b2c3d4)');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });
});

describe('the spacing of the blocks of the Permissions tab', () => {
  const SECTIONS = ['This session', 'Other sessions of this project', 'Blocked', 'Request a bypass'];

  it('every block has the same vertical padding (the one section token) and the module divider under it', () => {
    renderWith([grant('a1b2c3d4', 'rm')]);
    for (const name of SECTIONS) {
      const block = screen.getByRole('region', { name });
      expect(block.className, name).toContain(SECTION);
      // Nothing else adds a vertical padding to the block (a second value would break the rhythm).
      expect(block.className.replace(SECTION, ''), name).not.toMatch(/p[ty]-/);
    }
  });

  it('the blocks do not add a second gap of their own: the headings and the first line take the body margin only', () => {
    renderWith([grant('a1b2c3d4', 'rm')]);
    for (const name of ['This session', 'Other sessions of this project']) {
      const heading = within(screen.getByRole('region', { name })).getByRole('heading', { level: 4 });
      expect(heading.className, name).not.toMatch(/p[tb]-/);
    }
    const mine = screen.getByRole('region', { name: 'This session' });
    expect((mine.querySelector('[data-grant-rows]') as HTMLElement).parentElement?.className).toContain(SECTION_BODY);
    // The space after the table of grants, before the next block, is the padding of the block itself (and the divider).
    const others = screen.getByRole('region', { name: 'Other sessions of this project' });
    expect(mine.nextElementSibling).toBe(others);
    expect(mine.className).toContain('border-b border-border');
  });
});
