import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedDto, ownedRow } from '../logic/fixtures.js';
import type { OwnedSessionDto } from '../shared.js';
import { BG_NO_INTERRUPT, OwnedBar } from './OwnedBar.js';
import { stubFetch } from './testFetch.js';

afterEach(() => vi.unstubAllGlobals());

const ID = '11111111-1111-4111-8111-111111111111';
const JOB = 'abcd1234';
const listed = (...sessions: OwnedSessionDto[]) => ({ body: { ok: true, generatedAt: 'now', daemon: {}, sessions } });
const bgDto = (over: Partial<OwnedSessionDto> = {}) => ownedDto({ id: ID, hostKind: 'bg', jobId: JOB, attachCommand: `claude attach ${JOB}`, state: 'idle', bgState: 'done', permissionMode: 'default', ...over });
const bgRow = (over: Parameters<typeof ownedRow>[0] = {}) => ownedRow({ sessionId: ID, host: 'bg', ownedState: 'idle', ...over });

// A phone: only the max-width query matches.
function phone(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

function bar(row = bgRow()): void {
  render(<OwnedBar session={row} onChange={vi.fn()} onForgotten={vi.fn()} />);
}

describe('a Background session on a narrow screen: one compact row', () => {
  it('shows the command and two icon buttons in one row, and keeps the explanations behind the details toggle', async () => {
    phone();
    stubFetch({ 'GET /owned': listed(bgDto()) });
    bar();
    const row = await screen.findByText(`claude attach ${JOB}`);
    const compact = row.closest('[data-bg-compact]') as HTMLElement;
    expect(compact).not.toBeNull();
    const line = row.parentElement as HTMLElement;
    expect(line).toHaveClass('flex-nowrap');
    expect(row).toHaveClass('truncate');
    expect(line).toContainElement(screen.getByRole('button', { name: 'Copy command' }));
    const toggle = screen.getByRole('button', { name: 'Details' });
    expect(line).toContainElement(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The separate disclosure of the wide layout does not exist: its text lives in the details.
    expect(document.querySelector('[data-bg-limits]')).toBeNull();
    expect(document.querySelector('[data-bg-details]')).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('[data-bg-limits-list]')).toHaveTextContent(BG_NO_INTERRUPT);
    expect(screen.getByText('Open it in a terminal')).toBeInTheDocument();
  });

  it('a waiting session opens the details at once: what it waits on is never hidden', async () => {
    phone();
    stubFetch({ 'GET /owned': listed(bgDto({ state: 'requires_action', waitingFor: 'permission prompt', bgState: 'blocked' })) });
    bar(bgRow({ ownedState: 'requires_action' }));
    expect(await screen.findByText('Answer in a terminal: this session waits on a permission prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('the wide layout keeps the card and the disclosure as they were', async () => {
    stubFetch({ 'GET /owned': listed(bgDto()) });
    bar();
    await screen.findByText(`claude attach ${JOB}`);
    expect(document.querySelector('[data-bg-compact]')).toBeNull();
    expect(document.querySelector('[data-bg-limits]')).not.toBeNull();
  });
});
