import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GROUP_ORDER } from '../logic/states.js';
import { GROUP_STATE_EDGE, GroupHeaderName, groupHeaderBox, groupHeaderCount } from './groupHeaderLook.js';

describe('the group header looks (A/B ui-group-header)', () => {
  it('bar: a tinted bar with a coloured left edge; herdr and pill: no bar, and the right padding is the same in all three (the icons of the right column share one axis)', () => {
    expect(groupHeaderBox('bar', 'border-hue-blue')).toContain('border-l-4 border-hue-blue bg-muted-bg');
    expect(groupHeaderBox('herdr', 'border-hue-blue')).not.toContain('border-l-4');
    expect(groupHeaderBox('pill', 'border-hue-blue')).not.toContain('border-l-4');
    for (const variant of ['herdr', 'bar', 'pill'] as const) {
      expect(groupHeaderBox(variant, 'border-muted')).toContain('pr-2.5');
    }
  });

  it('the three looks differ in type size and in the count: 11 px plain, a grey pill, 12 px', () => {
    expect(groupHeaderCount('herdr')).toContain('text-[11px]');
    expect(groupHeaderCount('bar')).toContain('rounded-full');
    expect(groupHeaderCount('pill')).not.toContain('rounded-full');
    const { rerender } = render(<GroupHeaderName variant="herdr" text="shop" textClass="text-muted" />);
    expect(screen.getByText('shop').className).toContain('text-[11px]');
    rerender(<GroupHeaderName variant="bar" text="shop" textClass="text-muted" />);
    expect(screen.getByText('shop').className).toContain('text-sm');
  });

  it('every state group has an edge colour', () => {
    for (const id of GROUP_ORDER) {
      expect(GROUP_STATE_EDGE[id]).toMatch(/^border-/);
    }
  });

  it('pill puts the name in an outlined pill, the others in bold text', () => {
    const { rerender } = render(<GroupHeaderName variant="pill" text="shop" textClass="text-muted" />);
    expect(screen.getByText('shop').className).toContain('rounded-full');
    rerender(<GroupHeaderName variant="bar" text="shop" textClass="text-muted" />);
    expect(screen.getByText('shop').className).toContain('font-semibold');
    expect(screen.getByText('shop').className).not.toContain('rounded-full');
    rerender(<GroupHeaderName variant="herdr" text="shop" textClass="text-muted" />);
    expect(screen.getByText('shop').className).not.toContain('rounded-full');
  });
});
