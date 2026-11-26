import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { row } from '../logic/fixtures.js';
import { HerdrRowBody } from './HerdrRowBody.js';

const NOW = 2_000_000;
const session = row({ folder: 'shop', displayName: 'billing-owner', state: 'idle', statusUpdatedAt: 100 });

function body(overrides: Partial<Parameters<typeof HerdrRowBody>[0]> = {}) {
  return render(<HerdrRowBody session={session} density="herdr-tinted" now={NOW} terms={undefined} showSlot subagents={undefined} onMenu={vi.fn()} {...overrides} />);
}

/*
 * jsdom has no layout: the width priority (name first, then age and light, the folder and the icons give way first) is checked on the classes that carry it.
 * The real widths (300, 400, 390 px) are checked with agent-browser (research/ui-audit.md).
 */
describe('the width priority of a Herdr row', () => {
  it('the name never shrinks below its text before the folder is given up: the folder wraps out of the one-line box instead of squeezing the name', () => {
    const { container } = body();
    const name = container.querySelector<HTMLElement>('[data-herdr-name]');
    const folder = container.querySelector<HTMLElement>('[data-herdr-folder]');
    expect(name).not.toBeNull();
    expect(folder).not.toBeNull();
    // The box clips what wraps: the folder disappears when less than its minimum is left next to the name.
    const box = name?.parentElement;
    expect(box?.className).toContain('flex-wrap');
    expect(box?.className).toContain('overflow-hidden');
    expect(name?.className).toContain('max-w-full');
    expect(name?.className).toContain('truncate');
    expect(folder?.className).toContain('min-w-[7ch]');
  });

  it('the age and the state light never shrink', () => {
    const { container } = body();
    const column = container.querySelector<HTMLElement>('[data-status-column]');
    expect(column?.className).toContain('shrink-0');
    const age = container.querySelector<HTMLElement>('[data-herdr-age]');
    expect(age?.className).toContain('shrink-0');
  });

  it('the menu button is always drawn (no hover reveal), one row icon button in the flow that does not shrink, after the age and before the state light', () => {
    const { container } = body();
    const buttons = container.querySelectorAll<HTMLElement>('button');
    expect(buttons).toHaveLength(1);
    const button = buttons[0] as HTMLElement;
    expect(button).toHaveAttribute('data-row-icon-button');
    expect(button).toHaveAttribute('aria-label', 'Actions of billing-owner');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button.className).toContain('shrink-0');
    for (const hidden of ['hidden', 'opacity-0', 'group-hover', 'absolute']) {
      expect(button.className).not.toContain(hidden);
      expect(button.closest('[data-row-menu-button], span')?.className ?? '').not.toContain(hidden);
    }
    expect(container.querySelector('[data-herdr-actions]')).toBeNull();
    const age = container.querySelector<HTMLElement>('[data-herdr-age]');
    expect(age?.compareDocumentPosition(button) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('no menu button when the list has no action to offer', () => {
    const { container } = body({ onMenu: undefined });
    expect(container.querySelector('button')).toBeNull();
  });

  it('the sub-agent count is not drawn on the row line (the chevron label says it, where the list shows sub-agents)', () => {
    const many = row({ folder: 'shop', displayName: 'agent-manager-owner', state: 'idle', statusUpdatedAt: 100, subagentCount: 4 });
    const { container } = body({ session: many, subagents: { open: false, toggle: vi.fn() } });
    expect(container.querySelector('[data-herdr-subagents]')).toBeNull();
    expect(container.querySelector('[aria-label="4 sub-agents"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Show the 4 sub-agents"]')).not.toBeNull();
  });

  it('no folder text when it repeats the name; the name-only density has none', () => {
    const same = body({ session: row({ folder: 'billing-owner', displayName: 'billing-owner' }) });
    expect(same.container.querySelector('[data-herdr-folder]')).toBeNull();
    same.unmount();
    const nameOnly = body({ density: 'herdr-name' });
    expect(nameOnly.container.querySelector('[data-herdr-folder]')).toBeNull();
  });
});

describe('the left alignment of a Herdr row', () => {
  // The chevron slot is always the first child of the row, with and without sub-agents, so the state icon and the name start at the same x.
  it('reserves the same first slot with and without sub-agents', () => {
    const without = body({ subagents: undefined });
    const withoutSlot = without.container.querySelector<HTMLElement>('[data-row-chevron-slot]');
    expect(withoutSlot).not.toBeNull();
    expect(withoutSlot?.querySelector('button')).toBeNull();
    expect(withoutSlot?.previousElementSibling).toBeNull();
    const withoutClass = withoutSlot?.className;
    without.unmount();
    const withSubs = body({ subagents: { open: false, toggle: vi.fn() } });
    const slot = withSubs.container.querySelector<HTMLElement>('[data-row-chevron-slot]');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector('button')).not.toBeNull();
    expect(slot?.previousElementSibling).toBeNull();
    expect(slot?.className).toBe(withoutClass);
  });

  it('has no slot at all when the list does not show sub-agents, so every row starts with the program icon', () => {
    const { container } = body({ showSlot: false });
    expect(container.querySelector('[data-row-chevron-slot]')).toBeNull();
    expect(container.querySelector('button[aria-label*="sub-agents"]')).toBeNull();
  });
});

/*
 * The right side of every row is a set of fixed columns, in this order: marks (flag, pin, guardrail chip), age, "..." button, state light.
 * jsdom has no layout, so the fixed widths are checked on classes; the real x of the columns is measured with agent-browser.
 */
describe('the fixed columns on the right of a Herdr row', () => {
  it('the age is a fixed width column even when the registry gives no time', () => {
    const withTime = body();
    expect(withTime.container.querySelector('[data-herdr-age]')?.className).toContain('w-8');
    const without = body({ session: row({ folder: 'shop', displayName: 'x', state: 'idle', statusUpdatedAt: undefined }) });
    expect(without.container.querySelector('[data-herdr-age-empty]')?.className).toContain('w-8');
  });

  it('Needs you has no pill in the row (D2026-11-26k: the names keep the room): the red "!" light says it, in words for assistive technology', () => {
    const { container } = body({ session: row({ folder: 'shop', displayName: 'x', state: 'needs-you', statusUpdatedAt: 100 }) });
    expect(container.querySelector('[data-needs-you-pill]')).toBeNull();
    expect(container.textContent).not.toContain('Needs you!');
    const light = container.querySelector<HTMLElement>('[data-herdr-light="pill"]');
    expect(light).toHaveTextContent('!');
    expect(light?.querySelector('.sr-only')?.textContent).toBe('Needs you');
    expect(container.querySelector('[data-status-column]')).toHaveAttribute('data-status-column', 'icon');
  });

  it('the flag and the pin sit before the age', () => {
    const { container } = body({ session: row({ folder: 'shop', displayName: 'x', state: 'idle', statusUpdatedAt: 100, flagged: true, pinned: true }) });
    const age = container.querySelector<HTMLElement>('[data-herdr-age]') as HTMLElement;
    for (const name of ['Flagged', 'Pinned']) {
      const mark = [...container.querySelectorAll<HTMLElement>('.sr-only')].find((element) => element.textContent === name) as HTMLElement;
      expect(mark.compareDocumentPosition(age)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('the menu button sits in a fixed column of its own', () => {
    const { container } = body();
    expect(container.querySelector('[data-row-menu-column]')?.className).toContain('w-6');
  });
});
