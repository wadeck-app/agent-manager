import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// violations-suppress: ts/no-deep-relative test of the layouts reads the setting of the user, not exported through deps.ts (it is a test-only use)
import { CHAT_LAYOUT_CHOICES, CHAT_LAYOUT_IDS, DEFAULT_CHAT_LAYOUT, type ChatLayoutVariant } from '../../logic/chatLayoutPref.js';
// violations-suppress: ts/no-deep-relative the provider of the setting is not exported through deps.ts (test-only use)
import { ChatLayoutProvider } from '../../ui/ChatLayoutContext.js';
import { ChatFrame } from './ChatFrame.js';
import { CHAT_LAYOUTS } from './chatLayouts.js';
import { assistantText, userPrompt } from './entryFixtures.js';
import { describeEntry } from './rowModel.js';

const MARKDOWN = 'Here is the plan:\n\n- first item\n- second item\n\n```ts\nconst answer = 42;\n```\n\nSee [the docs](https://example.com/docs).';
const NO_CONTEXT = { isOpen: () => false, toggle: () => undefined };
const UUID = '11111111-0000-4000-8000-000000000001';

function frame(entry: ReturnType<typeof userPrompt>, variant: ChatLayoutVariant | undefined, props: { onThread?: () => void } = {}) {
  const model = describeEntry({ ...entry, uuid: UUID } as typeof entry);
  const inner = <ChatFrame model={model} open={false} onToggle={() => undefined} context={NO_CONTEXT} now={5_000} highlighted={false} {...props} />;
  // No provider: the default, as a component used alone shows it.
  return variant === undefined ? (
    inner
  ) : (
    <ChatLayoutProvider layout={variant} setLayout={() => undefined}>
      {inner}
    </ChatLayoutProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('chat layouts', () => {
  it('has four layouts, a descriptor and a one-line description for each, and the default is the rule', () => {
    expect([...CHAT_LAYOUT_IDS]).toEqual(['rule', 'bubbles', 'claude-ai', 'terminal']);
    for (const id of CHAT_LAYOUT_IDS) {
      expect(CHAT_LAYOUTS[id]).toBeDefined();
      expect(CHAT_LAYOUT_CHOICES[id].hint).not.toContain('\n');
    }
    // The layouts that were dropped (slack, card, irc, doc) have no descriptor left.
    expect(Object.keys(CHAT_LAYOUTS).sort()).toEqual([...CHAT_LAYOUT_IDS].sort());
    expect(DEFAULT_CHAT_LAYOUT).toBe('rule');
  });

  it('without a provider the rule layout draws: a coloured left rule and the name in the header', () => {
    const { container } = render(frame(assistantText('a1', 'hi'), undefined));
    expect(container.querySelector('[data-chat-role="assistant"] > div')).toHaveClass('border-l-2', 'border-hue-purple');
    expect(screen.getByText('Claude')).not.toHaveClass('sr-only');
  });

  it.each(CHAT_LAYOUT_IDS)('%s: an agent message keeps its markdown, its links, its code copy and its sender', (variant) => {
    render(frame(assistantText('a1', MARKDOWN), variant));
    expect(screen.getByText('first item')).toBeInTheDocument();
    expect(screen.getByText('second item')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute('href', 'https://example.com/docs');
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(screen.getByText('const answer = 42;')).toBeInTheDocument();
    // The name is on screen, or read aloud: never missing.
    expect(screen.getAllByText(/Claude|claude/).length).toBeGreaterThan(0);
  });

  it.each(CHAT_LAYOUT_IDS)('%s: a message of yours keeps its text, its sender, its age and the Thread action', (variant) => {
    const onThread = vi.fn();
    render(frame(userPrompt('u1', 'please fix the build'), variant, { onThread }));
    expect(screen.getByText('please fix the build')).toBeInTheDocument();
    expect(screen.getAllByText(/^(You|you)$/).length).toBeGreaterThan(0);
    // Hidden until hover in some layouts, but in the page and reachable by keyboard: never absent.
    expect(document.querySelector('time')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thread' }));
    expect(onThread).toHaveBeenCalledTimes(1);
  });

  it.each(CHAT_LAYOUT_IDS)('%s: every layout draws the same text for the same message', (variant) => {
    const { container } = render(frame(userPrompt('u1', 'one\ntwo with `code`'), variant));
    const body = container.textContent ?? '';
    expect(body).toContain('one');
    expect(body).toContain('two with `code`');
  });

  it('the bubbles layout: your message on the right, the agent one on the left in a bordered bubble with its header', () => {
    const user = render(frame(userPrompt('u1', 'hello'), 'bubbles'));
    expect(user.container.querySelector('[data-chat-role="user"]')).toHaveClass('flex', 'justify-end');
    expect(user.container.querySelector('[data-chat-role="user"] > div')).toHaveClass('max-w-am-prose', 'rounded-lg', 'bg-primary-light');
    user.unmount();
    const agent = render(frame(assistantText('a1', 'hi'), 'bubbles'));
    expect(agent.container.querySelector('[data-chat-role="assistant"]')).toHaveClass('flex', 'justify-start');
    expect(agent.container.querySelector('[data-chat-role="assistant"] > div')).toHaveClass('border-border', 'bg-surface');
    expect(screen.getByText('Claude')).not.toHaveClass('sr-only');
  });

  it('a layout without a name still shows a label that says more than the plain name', () => {
    const queued = { ...userPrompt('u3', 'later'), queued: true } as ReturnType<typeof userPrompt>;
    render(frame(queued, 'terminal'));
    expect(screen.getByText('You (queued)')).not.toHaveClass('sr-only');
  });

  it('a layout without a name reads the sender aloud', () => {
    render(frame(assistantText('a1', 'hi'), 'claude-ai'));
    expect(screen.getByText('Claude')).toHaveClass('sr-only');
  });

  describe('long messages', () => {
    const LONG = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n');

    it('a clamping layout cuts a long message and offers Show more, then Show less', () => {
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
      render(frame(userPrompt('u9', LONG), 'rule'));
      const more = screen.getByRole('button', { name: 'Show more of this message' });
      expect(document.querySelector('[data-clamped="true"]')).not.toBeNull();
      fireEvent.click(more);
      expect(document.querySelector('[data-clamped="true"]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Show less of this message' }));
      expect(document.querySelector('[data-clamped="true"]')).not.toBeNull();
    });

    it('a short message has no Show more', () => {
      render(frame(userPrompt('u9', 'short'), 'rule'));
      expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
    });

    it('a layout without clamp never offers Show more', () => {
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
      render(frame(userPrompt('u9', LONG), 'bubbles'));
      expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
    });
  });
});
