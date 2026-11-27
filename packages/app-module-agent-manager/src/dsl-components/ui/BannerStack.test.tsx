import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BannerStackProvider } from './BannerStack.js';
import { BannerStackSlot } from './BannerStackSlot.js';
import { headlineOf } from './bannerStackKit.js';
import { StackedBanner } from './StackedBanner.js';

const WAITS = 'This session waits for a permission, and it cannot be answered from this page: no herdr-core terminal runs the session process (pid 120; 22 Claude Code terminal(s) were looked at).';
const SOCKET = 'the socket transport cannot reach this session: the session publishes no inbox socket. Claude Code >= 2.1.224 is required for cross-session messaging.';

function page(retry = vi.fn()) {
  render(
    <BannerStackProvider>
      <StackedBanner id="a" tone="info" text={WAITS} />
      <StackedBanner id="b" tone="warning" text={SOCKET} action={{ label: 'Retry', onClick: retry }} />
      <BannerStackSlot className="slot" />
    </BannerStackProvider>,
  );
  return retry;
}

describe('headlineOf', () => {
  it('is the first clause, before the first colon or full stop, as a sentence', () => {
    expect(headlineOf(SOCKET)).toBe('The socket transport cannot reach this session');
    expect(headlineOf(WAITS)).toBe('This session waits for a permission, and it cannot be answered from this page');
    expect(headlineOf('the transport is off')).toBe('The transport is off');
  });
});

describe('BannerStack: one banner for every message of the pane', () => {
  it('draws ONE banner with the title of the worst message and the count of the others, never cut by an ellipsis', () => {
    page();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('The socket transport cannot reach this session');
    expect(banner).toHaveTextContent('and 1 more');
    expect(banner.querySelector('[class*="line-clamp"]')).toBeNull();
    // The worst tone gives the colour: the warning wins over the info.
    expect(banner.className).toContain('bg-warning-bg');
  });

  it('opens every message whole, with its action, and closes again', () => {
    const retry = page();
    const toggle = screen.getByRole('button', { name: 'Show all 2' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    const items = document.querySelectorAll('[data-stacked-item]');
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent('no herdr-core terminal runs the session process (pid 120; 22 Claude Code terminal(s) were looked at).');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(document.querySelectorAll('[data-stacked-item]')).toHaveLength(0);
  });

  it('a single short message has no toggle, a single long one has "Show more"', () => {
    const { unmount } = render(
      <BannerStackProvider>
        <StackedBanner id="a" tone="warning" text="the transport is off" />
        <BannerStackSlot className="slot" />
      </BannerStackProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('The transport is off');
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(
      <BannerStackProvider>
        <StackedBanner id="a" tone="warning" text={SOCKET} />
        <BannerStackSlot className="slot" />
      </BannerStackProvider>,
    );
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });

  it('draws nothing when a message goes away', () => {
    const { rerender } = render(
      <BannerStackProvider>
        <StackedBanner id="a" tone="warning" text="the transport is off" />
        <BannerStackSlot className="slot" />
      </BannerStackProvider>,
    );
    rerender(
      <BannerStackProvider>
        <BannerStackSlot className="slot" />
      </BannerStackProvider>,
    );
    expect(document.querySelector('[data-banner-stack]')).toBeNull();
  });

  it('without a stack above it, a message is a folded banner of its own (it never goes missing)', () => {
    render(<StackedBanner id="a" tone="warning" text="the transport is off" action={{ label: 'Retry', onClick: () => undefined }} />);
    expect(screen.getByRole('status')).toHaveTextContent('The transport is off');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
