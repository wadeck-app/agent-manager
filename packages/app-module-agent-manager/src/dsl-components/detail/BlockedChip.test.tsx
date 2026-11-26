import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { row } from '../logic/fixtures.js';
import { stubFetch } from '../owned/testFetch.js';
import type { GuardrailBlocksDto } from '../shared.js';
import { BlockedChip } from './BlockedChip.js';
import { DetailHeader } from './DetailHeader.js';
import { useRailRequests } from './railRequest.js';

afterEach(() => vi.unstubAllGlobals());

const ID = '11111111-1111-4111-8111-111111111111';

const BLOCKS: GuardrailBlocksDto = {
  total: 273,
  categories: [
    { category: 'interpreter-exec', count: 104 },
    { category: 'rm', count: 84 },
    { category: 'kill', count: 37 },
  ],
  timeout: false,
  recent: { total: 14, categories: [{ category: 'rm', count: 9 }, { category: 'kill', count: 5 }] },
};

function Listener({ onTab }: { onTab: (tab: string) => void }) {
  useRailRequests(ID, onTab);
  return null;
}

describe('the blocked chip of the detail header', () => {
  it('says how many blocks of the last 30 min, in one neutral button', () => {
    render(<BlockedChip sessionId={ID} blocks={BLOCKS} />);
    const chip = screen.getByRole('button', { name: '14 blocked in the last 30 min. Open the Permissions tab' });
    expect(chip).toHaveTextContent('14 blocked');
  });

  it.each([['no counters at all', undefined], ['blocks in total but none in the last 30 min', { ...BLOCKS, recent: { total: 0, categories: [] } }]])('%s: no chip', (_name, blocks) => {
    const { container } = render(<BlockedChip sessionId={ID} blocks={blocks} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a click asks the panel of THIS session for its Permissions tab, and not the panel of another one', async () => {
    const mine = vi.fn();
    const other = vi.fn();
    render(
      <>
        <Listener onTab={mine} />
        <BlockedChip sessionId={ID.toUpperCase()} blocks={BLOCKS} />
      </>,
    );
    const OTHER = '22222222-2222-4222-8222-222222222222';
    function Elsewhere() {
      useRailRequests(OTHER, other);
      return null;
    }
    render(<Elsewhere />);
    await userEvent.click(screen.getByRole('button', { name: /^14 blocked/ }));
    expect(mine).toHaveBeenCalledWith('permissions');
    expect(other).not.toHaveBeenCalled();
  });

  it('the detail header no longer carries the orange banner nor the copy buttons of the categories (they stay on the Guardrails page), only the chip', () => {
    stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [] } } });
    render(<DetailHeader session={row({ sessionId: ID, guardrailBlocks: BLOCKS })} now={2_000_000} busy={false} onBack={vi.fn()} onTogglePin={vi.fn()} onMarkSeen={vi.fn()} onOwnedChange={vi.fn()} onForgotten={vi.fn()} onForked={vi.fn()} onOpenSource={vi.fn()} />);
    expect(screen.queryByText(/Blocked 273 times/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Guardrails page' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Copy a bypass command' })).toBeNull();
    expect(screen.queryByRole('button', { name: /request-bypass/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^14 blocked/ })).toBeInTheDocument();
  });

  it('the header of a session with nothing blocked recently has no chip', () => {
    stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [] } } });
    render(<DetailHeader session={row({ sessionId: ID, guardrailBlocks: { ...BLOCKS, recent: { total: 0, categories: [] } } })} now={2_000_000} busy={false} onBack={vi.fn()} onTogglePin={vi.fn()} onMarkSeen={vi.fn()} onOwnedChange={vi.fn()} onForgotten={vi.fn()} onForked={vi.fn()} onOpenSource={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /blocked/ })).toBeNull();
  });
});
