import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardsDock } from '../detail/CardsDock.js';
import { ownedRow } from '../logic/fixtures.js';
import { PermissionCard } from './PermissionCard.js';
import { PermissionInput } from './PermissionInput.js';
import { stubFetch } from './testFetch.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ID = '11111111-1111-4111-8111-111111111111';
const waiting = () => ownedRow({ sessionId: ID, ownedState: 'requires_action', pendingPermissions: 1, state: 'needs-you' });
const listed = (command: string) => ({
  body: { ok: true, sessionId: ID, permissions: [{ requestId: 'req-1', toolName: 'Bash', input: { command }, description: 'Run it', receivedAt: 100 }] },
});

describe('PermissionInput: a short preview with an expand', () => {
  it('folds a text of more than 3 lines to 3 lines and says how much is hidden', async () => {
    render(<PermissionInput label="Command" text={'a\nb\nc\nd'} />);
    const pre = document.querySelector('pre') as HTMLElement;
    expect(pre).toHaveClass('line-clamp-3');
    expect(pre.textContent).toBe('a\nb\nc\nd');
    await userEvent.click(screen.getByRole('button', { name: /Show all \(4 lines/ }));
    expect(pre).not.toHaveClass('line-clamp-3');
  });

  it('folds one very long line, and leaves a short command whole without a button', () => {
    const { unmount } = render(<PermissionInput label="Command" text={'x'.repeat(300)} />);
    expect(document.querySelector('pre')).toHaveClass('line-clamp-3');
    unmount();
    render(<PermissionInput label="Command" text={'a\nb\nc'} />);
    expect(document.querySelector('pre')).not.toHaveClass('line-clamp-3');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PermissionRequest: compact layout', () => {
  it('puts Deny and Allow once in one row that never wraps, and stacks the reason full width under it on a narrow screen', async () => {
    stubFetch({ [`GET /owned/${ID}/permissions`]: listed('npm test') });
    render(<PermissionCard session={waiting()} />);
    const deny = await screen.findByRole('button', { name: 'Deny' });
    const buttons = deny.closest('[data-permission-buttons]') as HTMLElement;
    expect(buttons).toHaveClass('flex-nowrap');
    expect(buttons).toContainElement(screen.getByRole('button', { name: 'Allow once' }));
    const actions = buttons.parentElement as HTMLElement;
    expect(actions).toHaveAttribute('data-permission-actions');
    // Narrow: a column, the buttons first (reverse of the DOM order); from sm: one row, the reason beside the buttons.
    expect(actions).toHaveClass('flex-col-reverse', 'sm:flex-row');
    const field = screen.getByLabelText(/Reason for the agent if you deny/).closest('[data-permission-reason]') as HTMLElement;
    expect(field).toHaveClass('w-full', 'sm:flex-1');
    expect(actions).toContainElement(field);
  });

  it('is compact: tight padding on the card', async () => {
    stubFetch({ [`GET /owned/${ID}/permissions`]: listed('npm test') });
    render(<PermissionCard session={waiting()} />);
    const card = await screen.findByRole('region', { name: 'Permission requests' });
    expect(card).toHaveClass('py-2');
  });
});

describe('CardsDock: the cards never take the log', () => {
  it('holds at most 35 percent of the panel, scrolls inside beyond, and shrinks before the log', () => {
    render(
      <CardsDock>
        <p>card</p>
      </CardsDock>,
    );
    const dock = screen.getByText('card').parentElement as HTMLElement;
    expect(dock).toHaveAttribute('data-cards-dock');
    expect(dock).toHaveClass('max-h-[35%]', 'overflow-y-auto', 'min-h-0', 'shrink');
  });
});

describe('PermissionRequest: the reason field costs one line', () => {
  it('keeps its label for screen readers, shows it as the placeholder, and puts the description on at most 2 lines', async () => {
    stubFetch({ [`GET /owned/${ID}/permissions`]: listed('npm test') });
    render(<PermissionCard session={waiting()} />);
    const input = await screen.findByLabelText(/Reason for the agent if you deny/);
    expect(input).toHaveAttribute('placeholder', 'Reason if you deny (optional)');
    // The visible label of the field is replaced by the placeholder: the label stays in the page for the accessible name only.
    expect((input.closest('[data-permission-reason]') as HTMLElement).className).toContain('[&_label]:sr-only');
  });
});
