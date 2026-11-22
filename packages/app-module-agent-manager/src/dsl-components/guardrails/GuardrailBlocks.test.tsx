import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuardrailBlocksDto } from '../shared.js';
import { GuardrailBlocks } from './GuardrailBlocks.js';

afterEach(() => vi.unstubAllGlobals());

const LONG: GuardrailBlocksDto = {
  total: 555,
  categories: [
    { category: 'rm', count: 179 },
    { category: 'interpreter-exec', count: 173 },
    { category: 'kill', count: 46 },
    { category: 'eval', count: 40 },
    { category: 'python', count: 17 },
  ],
} as GuardrailBlocksDto;

const FULL = 'Blocked 555 times (rm 179, interpreter-exec 173, kill 46, 2 more)';

function viewport(phone: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: phone && query.includes('max-width'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

describe('GuardrailBlocks in a narrow header', () => {
  it('clamps the sentence to 2 lines, keeps the full text in the tooltip, and expands with "more" then collapses with "less"', async () => {
    viewport(true);
    render(<GuardrailBlocks blocks={LONG} />);
    const text = screen.getByText(FULL);
    expect(text).toHaveClass('line-clamp-2');
    expect(text).toHaveAttribute('title', FULL);
    await userEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(screen.getByText(FULL)).not.toHaveClass('line-clamp-2');
    await userEvent.click(screen.getByRole('button', { name: 'less' }));
    expect(screen.getByText(FULL)).toHaveClass('line-clamp-2');
  });

  it('shows no toggle on a wide window', () => {
    viewport(false);
    render(<GuardrailBlocks blocks={LONG} />);
    expect(screen.queryByRole('button', { name: 'more' })).toBeNull();
  });
});

describe('GuardrailBlocks link', () => {
  it('links to the Guardrails page of the module in the shell, not to a path the shell does not serve', () => {
    viewport(false);
    render(<GuardrailBlocks blocks={LONG} />);
    expect(screen.getByRole('link', { name: 'Guardrails page' })).toHaveAttribute('href', '/modules/agent-manager/guardrails');
  });
});
