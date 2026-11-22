import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageTitle } from './PageTitle.js';

describe('PageTitle', () => {
  it('is the one h1 of the page, at the size of the Agents page title (base, semibold), with its sentence under it', () => {
    render(<PageTitle title="Guardrails" subtitle="What the plugin granted." />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Guardrails' });
    expect(h1.className).toContain('text-base');
    expect(h1.className).toContain('font-semibold');
    expect(h1.className).not.toMatch(/text-(2xl|xl|lg)|font-bold/);
    expect(screen.getByText('What the plugin granted.').className).toContain('text-sm');
  });

  it('has no sentence line without a subtitle', () => {
    const { container } = render(<PageTitle title="Agents table" />);
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
});
