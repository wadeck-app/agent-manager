import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriorityControl } from '../detail/composer/PriorityControl.js';
import { ShieldWithBadge } from '../detail/log/ShieldWithBadge.js';
import { ownedDto, ownedRow } from '../logic/fixtures.js';
import { OwnedBar } from './OwnedBar.js';
import { REASON_PLACEHOLDER } from './PermissionRequest.js';
import { stubFetch } from './testFetch.js';

// The measured defects at 390 px (jsdom has no layout: these pin the classes that fixed them, the real measure is poc/scripts/overflow-scan.js).
afterEach(() => vi.unstubAllGlobals());

const ID = '11111111-1111-4111-8111-111111111111';

describe('the detail at 390 px', () => {
  it('the Mode row may shrink below the width of its select (the select was 294 px wide and left the header at 390)', async () => {
    stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [ownedDto({ id: ID, permissionMode: 'default' })] } } });
    render(<OwnedBar session={ownedRow({ sessionId: ID })} onChange={vi.fn()} onForgotten={vi.fn()} />);
    const select = await screen.findByLabelText('Permission mode');
    const label = select.closest('label') as HTMLElement;
    expect(label).toHaveClass('min-w-0', 'max-w-full');
    // The span the base select sits in is what holds the width.
    expect(label.className).toContain('[&>span]:min-w-0');
    expect(label.className).toContain('[&>span]:shrink');
  });

  it('the "when the agent reads it" choices wrap instead of leaving the composer, without a divider on a phone', () => {
    render(<PriorityControl priority="next" onChange={vi.fn()} disabled={false} />);
    const group = screen.getByRole('group', { name: 'When the agent reads the message' });
    expect(group).toHaveClass('flex-wrap', 'max-w-full');
    const divider = group.querySelector('[aria-hidden="true"].w-px') as HTMLElement;
    expect(divider).toHaveClass('hidden', 'sm:block');
  });

  it('the badge of the shield stays inside the rail (it was 1.5 px past the edge of a 390 px viewport)', () => {
    render(<ShieldWithBadge count={3} />);
    const badge = document.querySelector('[data-permissions-badge]') as HTMLElement;
    expect(badge).toHaveClass('right-0');
    expect(badge).not.toHaveClass('-right-0.5');
  });

  it('the placeholder of the deny reason fits a 288 px field (the full sentence was cut): short, while the label keeps the whole sentence', () => {
    // About 7 px per character at text-sm: 40 characters stay under 288 px with the padding.
    expect(REASON_PLACEHOLDER.length).toBeLessThanOrEqual(40);
    expect(REASON_PLACEHOLDER).toContain('(optional)');
  });
});
