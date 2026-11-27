import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FoldedBanner, FOLD_AT } from './FoldedBanner.js';

const LONG = `the claude process of this owned session ended. resume the session (see \`Resume\`); ${'the conversation continues, '.repeat(8)}the lost turn is not replayed`;

describe('FoldedBanner: a long server text takes two lines, the whole text is one click away', () => {
  it('a short text is shown whole, as a sentence, with no toggle', () => {
    render(<FoldedBanner tone="warning" text="the transport is off" />);
    expect(screen.getByRole('status')).toHaveTextContent('The transport is off');
    expect(screen.queryByRole('button', { name: /Show/ })).toBeNull();
  });

  it('a long text is clamped to two lines with Show more, then Show less, and never cut', () => {
    expect(LONG.length).toBeGreaterThan(FOLD_AT);
    render(<FoldedBanner tone="warning" text={LONG} />);
    const text = screen.getByText(/The claude process of this owned session ended/);
    expect(text.className).toContain('line-clamp-2');
    // The text is in the page whole (clamped by CSS only): a screen reader and a search find all of it.
    expect(text).toHaveTextContent('the lost turn is not replayed');
    const toggle = screen.getByRole('button', { name: 'Show more' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByText(/The claude process/).className).not.toContain('line-clamp');
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('has no raw backtick, and starts every sentence with a capital', () => {
    render(<FoldedBanner tone="warning" text={LONG} />);
    const text = screen.getByText(/The claude process/).textContent ?? '';
    expect(text).not.toContain('`');
    expect(text).toContain('Resume the session (see "Resume")');
  });
});
