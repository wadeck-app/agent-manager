import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StyledCheckbox } from './StyledCheckbox.js';

describe('StyledCheckbox', () => {
  it('draws a 16 px box but catches the click on a 24 px square around it (hit area of a small control)', () => {
    render(<StyledCheckbox aria-label="Select a" checked={false} onChange={() => undefined} />);
    const input = screen.getByRole('checkbox', { name: 'Select a' });
    expect(input).toHaveClass('h-6', 'w-6', '-left-1', '-top-1');
    // The visible box is unchanged.
    const box = input.parentElement?.querySelector('[data-styled-checkbox]');
    expect(box).toHaveClass('h-4', 'w-4');
    expect(input.parentElement).toHaveClass('h-4', 'w-4');
  });
});
