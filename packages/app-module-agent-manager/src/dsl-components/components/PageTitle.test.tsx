import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PageTitle } from './PageTitle.js';

beforeEach(() => window.sessionStorage.clear());

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

  it('has no notices button and no inline notice when there is nothing to say', () => {
    render(<PageTitle title="Agents table" errorText="" unreadableText="" />);
    expect(screen.queryByRole('button', { name: /notices?$/ })).toBeNull();
  });

  it('puts the notices button right-aligned on the title line, and the notices only in its panel (no inline stack)', () => {
    render(<PageTitle title="Agents table" errorText="boom" unreadableText="2 registry files could not be read, the sessions in them are not shown: a (b)" />);
    const button = screen.getByRole('button', { name: '2 notices' });
    expect(button.closest('.ml-auto')).not.toBeNull();
    expect(screen.queryByText('Sessions cannot be listed')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByText('Sessions cannot be listed')).toBeInTheDocument();
    expect(screen.getByText('2 registry files unreadable')).toBeInTheDocument();
  });

  it('lists the problems of the Guardrails overview, or its failure', () => {
    const { rerender } = render(<PageTitle title="Guardrails" guardrails={{ ok: false, errorText: 'The folder cannot be read' }} />);
    fireEvent.click(screen.getByRole('button', { name: '1 notice' }));
    expect(screen.getByText('Guardrails overview unavailable')).toBeInTheDocument();
    rerender(<PageTitle title="Guardrails" guardrails={undefined} />);
    expect(screen.queryByRole('button', { name: /notices?$/ })).toBeNull();
  });
});
