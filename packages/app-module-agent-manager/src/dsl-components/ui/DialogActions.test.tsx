import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DialogActions } from './DialogActions.js';

describe('DialogActions', () => {
  it('draws its top line with the border token (the base footer sets border-t with no colour: a bright hairline in dark mode)', () => {
    render(
      <DialogActions>
        <button type="button">Close</button>
      </DialogActions>,
    );
    const footer = screen.getByRole('button', { name: 'Close' }).parentElement;
    expect(footer?.className).toContain('border-t');
    expect(footer?.className).toContain('border-border');
  });
});
