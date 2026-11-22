import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageNote } from './PageNote.js';

describe('PageNote', () => {
  it('is one paragraph in the module body size (text-sm of the density scale), in a bordered box', () => {
    render(<PageNote text="Fed by the registry." />);
    const note = screen.getByText('Fed by the registry.');
    expect(note.tagName).toBe('P');
    expect(note.className).toContain('text-sm');
    expect(note.className).toContain('border-border');
  });
});
