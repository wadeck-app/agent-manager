import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { row } from '../logic/fixtures.js';
import { HerdrRowBody } from './HerdrRowBody.js';

const NOW = 2_000_000;
const session = row({ folder: 'shop', displayName: 'billing-owner', state: 'idle', statusUpdatedAt: 100 });

function body(overrides: Partial<Parameters<typeof HerdrRowBody>[0]> = {}) {
  return render(<HerdrRowBody session={session} density="herdr-line" now={NOW} terms={undefined} subagents={undefined} onMove={vi.fn()} onMenu={vi.fn()} {...overrides} />);
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
    const light = container.querySelector<HTMLElement>('[data-herdr-light]');
    expect(light?.className).toContain('shrink-0');
    const age = container.querySelector<HTMLElement>('[data-herdr-age]');
    expect(age?.className).toContain('shrink-0');
  });

  it('the hover buttons (move, menu) take no room in the row: they float over it, so the name keeps their width', () => {
    const { container } = body();
    const actions = container.querySelector<HTMLElement>('[data-herdr-actions]');
    expect(actions).not.toBeNull();
    expect(actions?.className).toContain('absolute');
    expect(actions?.querySelectorAll('button')).toHaveLength(2);
    // Nothing else of the row is a button in the flow (no 20 px hidden slot next to the name).
    const inFlow = Array.from(container.querySelectorAll('button')).filter((button) => !(actions?.contains(button) ?? false));
    expect(inFlow).toHaveLength(0);
  });

  it('no folder text when it repeats the name; the name-only density has none', () => {
    const same = body({ session: row({ folder: 'billing-owner', displayName: 'billing-owner' }) });
    expect(same.container.querySelector('[data-herdr-folder]')).toBeNull();
    same.unmount();
    const nameOnly = body({ density: 'herdr-name' });
    expect(nameOnly.container.querySelector('[data-herdr-folder]')).toBeNull();
  });
});
