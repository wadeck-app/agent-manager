import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionsTable } from '../components/SessionsTable.js';
import { ShieldWithBadge } from '../detail/log/ShieldWithBadge.js';
import { CHIP as STATUS_CHIP, CHIP_WARNING } from '../detail/status/chipStyle.js';
import { row } from '../logic/fixtures.js';
import { HostBadge } from '../owned/OwnedChips.js';
import { OwnedStateChip } from '../owned/OwnedStateChip.js';
import { Chip, CHIP_BASE, chipClass, type ChipVariant } from './Chip.js';
import { COUNT_BADGE_BASE, CountBadge } from './CountBadge.js';
import { StateChip } from './StateChip.js';

// One skin: a fixed 20 px height, the same padding and text size, a soft fill and a subtle border. The tests read classes (jsdom has no layout).
const SKIN = ['h-5', 'rounded-full', 'border', 'px-2', 'text-xs', 'leading-none', 'inline-flex', 'items-center', 'shrink-0', 'whitespace-nowrap'];

describe('Chip', () => {
  it('has one base skin and five variants, each a soft fill with a subtle border', () => {
    for (const token of SKIN) {
      expect(CHIP_BASE.split(' ')).toContain(token);
    }
    const variants: ChipVariant[] = ['neutral', 'info', 'warning', 'danger', 'success'];
    for (const variant of variants) {
      render(<Chip variant={variant}>{variant}</Chip>);
      const chip = screen.getByText(variant);
      expect(chip.className).toBe(chipClass(variant));
      expect(chip.className).toMatch(/\bbg-\S+/);
      expect(chip.className).toMatch(/\bborder-\S+/);
      expect(chip.className).toMatch(/\btext-\S+/);
    }
  });

  it('shows an optional icon as decoration, and lets the caller add attributes and a class', () => {
    render(
      <Chip variant="danger" icon={<svg data-testid="ic" />} data-x="1" className="extra">
        Needs you
      </Chip>,
    );
    const chip = screen.getByText('Needs you');
    expect(chip).toHaveAttribute('data-x', '1');
    expect(chip).toHaveClass('extra', 'h-5');
    expect(screen.getByTestId('ic').parentElement).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('CountBadge', () => {
  it('is a circle or a pill, at least 16 px high, with tabular digits', () => {
    render(<CountBadge tone="primary">12</CountBadge>);
    const badge = screen.getByText('12');
    for (const token of COUNT_BADGE_BASE.split(' ')) {
      expect(badge).toHaveClass(token);
    }
    expect(badge).toHaveClass('h-4', 'min-w-4', 'rounded-full', 'tabular-nums');
  });
});

describe('every chip of the module wears the one skin', () => {
  const hasSkin = (element: Element | null | undefined): void => {
    expect(element).not.toBeNull();
    for (const token of SKIN) {
      expect(element, token).toHaveClass(token);
    }
  };

  it('host chips, the owned state chip, the state chip, the table harness chip', () => {
    const { container } = render(
      <>
        <HostBadge session={{ launchedBy: 'agent-manager', host: 'stream-json' }} />
        <OwnedStateChip session={{ launchedBy: 'agent-manager', ownedState: 'exited', ownedRawState: undefined, registryPending: false, pendingPermissions: 0, host: 'hc' }} />
        <StateChip state="needs-you" />
      </>,
    );
    hasSkin(container.querySelector('[data-host-badge]'));
    hasSkin(container.querySelector('[data-owned-state]'));
    hasSkin(container.querySelector('[data-state-chip]'));
    const table = render(<SessionsTable rows={[row({ harness: 'Claude Code 2.1.325' })]} />);
    hasSkin(table.container.querySelector('[data-harness-chip]'));
  });

  it('the status row chips of the header share the base and the variants', () => {
    expect(STATUS_CHIP).toContain(chipClass('neutral'));
    expect(CHIP_WARNING).toContain(chipClass('warning'));
  });
});

describe('the permission rail badge', () => {
  it('is the shared count badge, kept in the corner of its button', () => {
    render(
      <button type="button" className="relative">
        <ShieldWithBadge count={3} />
      </button>,
    );
    const badge = document.querySelector('[data-permissions-badge]') as HTMLElement;
    expect(badge).toHaveTextContent('3');
    expect(badge).toHaveClass('h-4', 'min-w-4', 'rounded-full', 'tabular-nums', 'absolute');
  });
});
