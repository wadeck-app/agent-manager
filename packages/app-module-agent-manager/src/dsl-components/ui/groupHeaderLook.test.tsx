import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GROUP_ORDER } from '../logic/states.js';
import { GROUP_STATE_EDGE, GroupHeaderName, groupHeaderBar } from './groupHeaderLook.js';

describe('the group header looks (A/B ui-group-header)', () => {
  it('bar: a tinted bar with a coloured left edge; plain and pill: no bar', () => {
    expect(groupHeaderBar('bar', 'border-hue-blue')).toBe('border-l-4 border-hue-blue bg-muted-bg pl-1');
    expect(groupHeaderBar('plain', 'border-hue-blue')).toBe('');
    expect(groupHeaderBar('pill', 'border-hue-blue')).toBe('');
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
  });
});
