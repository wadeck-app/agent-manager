import { render, screen } from '@testing-library/react';
import { KeyRound } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Section } from './Section.js';

describe('Section', () => {
  it('lets its header wrap (title, count and actions never push each other out of a narrow screen) and keeps the title below the page title in size', () => {
    render(
      <Section id="s" icon={KeyRound} title="Recent denials" count={3} actions={<button type="button">Show commands</button>}>
        <p>body</p>
      </Section>,
    );
    const title = screen.getByRole('heading', { level: 2, name: 'Recent denials' });
    expect(title.parentElement?.className).toContain('flex-wrap');
    expect(title.className).toContain('text-sm');
    expect(screen.getByText('3').className).toContain('text-muted-tint');
    expect(screen.getByRole('button', { name: 'Show commands' }).parentElement?.className).toContain('flex-wrap');
  });
});
