import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedDto, ownedRow } from '../logic/fixtures.js';
import { stubFetch } from '../owned/testFetch.js';
import { DetailHeader } from './DetailHeader.js';

afterEach(() => vi.unstubAllGlobals());

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function header() {
  return <DetailHeader session={ownedRow({ sessionId: ID })} now={2_000_000} busy={false} onBack={() => undefined} onTogglePin={() => undefined} onMarkSeen={() => undefined} onOwnedChange={() => undefined} onForgotten={() => undefined} onForked={() => undefined} onOpenSource={() => undefined} />;
}

/** What the live audit counted: the controls of an owned session must exist exactly once, whatever the dialogs of the header did. */
function counts() {
  return {
    bars: document.querySelectorAll('[data-owned-bar]').length,
    modes: document.querySelectorAll('select[aria-label="Permission mode"]').length,
    stops: screen.queryAllByRole('button', { name: /^Stop/ }).length,
  };
}

describe('the header of an owned session keeps one set of controls', () => {
  it('after the Fork dialog opens and closes (Escape, then Cancel)', async () => {
    stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [ownedDto({ id: ID })] } } });
    render(header());
    await screen.findByLabelText('Permission mode');
    expect(counts()).toEqual({ bars: 1, modes: 1, stops: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect(counts()).toEqual({ bars: 1, modes: 1, stops: 1 });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(counts()).toEqual({ bars: 1, modes: 1, stops: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Fork' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(counts()).toEqual({ bars: 1, modes: 1, stops: 1 });
  });
});
