import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StyledCheckbox } from '../ui/StyledCheckbox.js';

describe('the shared styled checkbox', () => {
  it('keeps a native checkbox input with its aria-label, inside a styled box', () => {
    const { container } = render(<StyledCheckbox aria-label="Select x" checked={false} onChange={() => undefined} />);
    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input?.getAttribute('aria-label')).toBe('Select x');
    expect(container.querySelector('[data-styled-checkbox]')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('shows a check when checked and a dash when indeterminate', () => {
    const checked = render(<StyledCheckbox aria-label="a" checked onChange={() => undefined} />);
    expect(checked.container.querySelector('[data-styled-checkbox] svg')).not.toBeNull();
    checked.unmount();
    const some = render(<StyledCheckbox aria-label="b" checked={false} indeterminate onChange={() => undefined} />);
    expect(some.container.querySelector('input')?.indeterminate).toBe(true);
    expect(some.container.querySelector('[data-styled-checkbox] svg')).not.toBeNull();
  });
});
