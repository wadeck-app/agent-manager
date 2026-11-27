import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StyledRadio } from './StyledRadio.js';

describe('StyledRadio (Q25: the native radio rings were olive in the dark theme)', () => {
  it('keeps a real radio input for the click, the label and the screen readers, and draws the ring with theme tokens', () => {
    const onChange = vi.fn();
    const { container } = render(
      <label>
        <StyledRadio name="x" checked={false} onChange={onChange} />
        Choice
      </label>,
    );
    const input = screen.getByRole('radio', { name: 'Choice' });
    expect(input).not.toBeChecked();
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    const ring = container.querySelector<HTMLElement>('[data-styled-radio]');
    expect(ring?.className).toContain('border-muted-tint');
    expect(ring?.className).not.toContain('bg-primary-solid');
    expect(ring).toHaveAttribute('aria-hidden', 'true');
  });

  it('checked: the ring is filled with the primary solid token and has a dot', () => {
    const { container } = render(<StyledRadio name="x" checked onChange={vi.fn()} aria-label="On" />);
    expect(screen.getByRole('radio', { name: 'On' })).toBeChecked();
    const ring = container.querySelector<HTMLElement>('[data-styled-radio]');
    expect(ring?.className).toContain('bg-primary-solid');
    expect(ring?.querySelector('span')).not.toBeNull();
  });
});
