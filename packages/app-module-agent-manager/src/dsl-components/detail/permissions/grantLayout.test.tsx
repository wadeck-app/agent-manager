import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// violations-suppress: ts/no-deep-relative test fixtures of the logic folder
import { overview } from '../../logic/permissionsFixtures.js';
// violations-suppress: ts/no-deep-relative test fixtures of the owned folder
import { stubFetch } from '../../owned/testFetch.js';

import { DEFAULT_UI_VARIANTS, GRANT_ROW, permissionsOf, row, UiVariantsContext, type GrantRowVariant } from '../deps.js';
import type { CliGrantDto, SessionGrantsDto } from '../deps.js';
import { PermissionsPanel } from './PermissionsPanel.js';

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

function renderWith(variant: GrantRowVariant, grants: CliGrantDto[]) {
  const files = overview([]);
  return render(
    <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS, grantRow: variant }}>
      <PermissionsPanel session={session} feed={{ overview: files, view: permissionsOf(files, SID, session.cwd), error: '', loading: false, reload: vi.fn(), cli: { kind: 'ok', data: data(grants) } }} />
    </UiVariantsContext.Provider>,
  );
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

// jsdom has no layout: the structure is what can be pinned. The title and the trash icon must share one line (a wrapper that is not the row itself), whatever the look.
describe.each(GRANT_ROW)('the bypass row, look "%s"', (variant) => {
  it('shows the facts and offers the same revoke: the trash icon sits on the line of the title, with its accessible name', () => {
    renderWith(variant, [grant('a1b2c3d4', 'rm', { usesLeft: 1, mode: 'once' })]);
    const item = screen.getByRole('region', { name: 'This session' }).querySelector('[data-cli-grant="a1b2c3d4"]') as HTMLElement;
    expect(item.closest('[data-grant-rows]')).toHaveAttribute('data-grant-rows', variant);
    const revoke = within(item).getByRole('button', { name: 'Revoke the rm bypass' });
    const title = within(item).getAllByText('rm')[0] as HTMLElement;
    // The line of the title is a wrapper inside the row, not the row: the icon is not on a line of its own under the text.
    expect(commonAncestor(title, revoke)).not.toBe(item);
    expect(item.querySelector('[data-grant-left]')).toHaveTextContent('10 min left');
    expect(item).not.toHaveTextContent('no use limit');
    expect(item).not.toHaveTextContent('full id');
  });

  it('Revoke asks first, then sends the PIN-gated request for this bypass only', async () => {
    const { calls } = stubFetch({ ...CSRF, 'POST /guardrails/grants/a1b2c3d4/revoke': revoked('a1b2c3d4', 'rm') });
    renderWith(variant, [grant('a1b2c3d4', 'rm')]);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the rm bypass' }));
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(screen.getByText('Revoke the rm bypass (10 min left)? The guardrail applies again to this session at once.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Revoked the rm bypass (a1b2c3d4)');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });
});

describe('the look "grouped"', () => {
  const pair = [grant('a1b2c3d4', 'git-commit', { reason: 'ship the fix' }), grant('b2c3d4e5', 'git-push', { reason: 'ship the fix' }), grant('c3d4e5f6', 'rm', { reason: 'clean up' })];

  it('folds the bypasses that share session, reason and expiry minute into one row with one revoke; the others stay alone', () => {
    renderWith('grouped', pair);
    const items = document.querySelectorAll('[data-grant-row]');
    expect(items).toHaveLength(2);
    const group = items[0] as HTMLElement;
    expect(within(group).getByText('git-commit')).toBeInTheDocument();
    expect(within(group).getByText('git-push')).toBeInTheDocument();
    expect(within(group).getAllByRole('button', { name: /^Revoke/ })).toHaveLength(1);
    expect(within(group).getByRole('button', { name: 'Revoke the 2 bypasses: git-commit and git-push' })).toBeInTheDocument();
  });

  it('one confirmation, then one revoke request per bypass, one after the other', async () => {
    const { calls } = stubFetch({ ...CSRF, 'POST /guardrails/grants/a1b2c3d4/revoke': revoked('a1b2c3d4', 'git-commit'), 'POST /guardrails/grants/b2c3d4e5/revoke': revoked('b2c3d4e5', 'git-push') });
    renderWith('grouped', pair.slice(0, 2));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the 2 bypasses: git-commit and git-push' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2));
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual(['/guardrails/grants/a1b2c3d4/revoke', '/guardrails/grants/b2c3d4e5/revoke']);
  });

  it('the first refusal stops the group: the second bypass is not revoked and the failure stays on screen', async () => {
    const { calls } = stubFetch({ ...CSRF, 'POST /guardrails/grants/a1b2c3d4/revoke': { status: 409, body: { ok: false, error: { code: 'grant-not-found', message: 'gone', hint: 'Refresh.' } } } });
    renderWith('grouped', pair.slice(0, 2));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the 2 bypasses: git-commit and git-push' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The git-commit bypass a1b2c3d4 was not revoked'));
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });
});

describe('the look "expand"', () => {
  it('opens on a click and shows the reason in full, the id and the expiry; closed again on the next click', () => {
    renderWith('expand', [grant('a1b2c3d4', 'rm')]);
    const toggle = screen.getByRole('button', { name: 'rm bypass details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-grant-details]')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('[data-grant-details]')).toHaveTextContent('clean the build folder');
    expect(document.querySelector('[data-grant-details]')).toHaveTextContent('a1b2c3d4');
    fireEvent.click(toggle);
    expect(document.querySelector('[data-grant-details]')).toBeNull();
  });
});
