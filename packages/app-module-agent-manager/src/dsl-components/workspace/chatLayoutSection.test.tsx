import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LogFilterMenu } from '../detail/log/LogFilterMenu.js';
import { DEFAULT_CHAT_LAYOUT, type ChatLayoutVariant } from '../logic/chatLayoutPref.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { ChatLayoutProvider, useChatLayout, useChatLayoutControl } from '../ui/ChatLayoutContext.js';
import { ListLayoutMenu } from './ListLayoutMenu.js';

function Shown() {
  return <span data-testid="layout">{useChatLayout()}</span>;
}

function Page({ onSave }: { onSave: (layout: ChatLayoutVariant) => void }) {
  const [layout, setLayout] = useState<ChatLayoutVariant>(DEFAULT_CHAT_LAYOUT);
  return (
    <ChatLayoutProvider
      layout={layout}
      setLayout={(next) => {
        onSave(next);
        setLayout(next);
      }}
    >
      <ListLayoutMenu mode="tree" onMode={vi.fn()} options={DEFAULT_VIEW_OPTIONS} onOptions={vi.fn()} />
      <LogFilterMenu sessionId="s1" />
      <Shown />
    </ChatLayoutProvider>
  );
}

describe('the Chat setting', () => {
  it('the Chat section of the list menu has the four choices with a one-line description and the rule checked', () => {
    render(<Page onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'List layout and view options' }));
    const section = document.querySelector<HTMLElement>('[data-section="chat"]') as HTMLElement;
    expect(within(section).getByText('Chat')).toBeInTheDocument();
    const group = within(section).getByRole('radiogroup', { name: 'Chat layout' });
    expect(within(group).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual([
      expect.stringContaining('Rule (default)'),
      expect.stringContaining('Bubbles'),
      expect.stringContaining('Claude.ai'),
      expect.stringContaining('Terminal'),
    ]);
    expect(within(group).getByRole('radio', { name: /^Rule/ })).toBeChecked();
    expect(within(group).queryByRole('radio', { name: /Slack|Card|IRC|Document/ })).toBeNull();
  });

  it('picking in the list menu saves once and the log popup shows the same choice (one source of truth)', () => {
    const onSave = vi.fn();
    render(<Page onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'List layout and view options' }));
    const list = document.querySelector<HTMLElement>('[data-section="chat"]') as HTMLElement;
    fireEvent.click(within(list).getByRole('radio', { name: /^Terminal/ }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(screen.getByTestId('layout')).toHaveTextContent('terminal');
    fireEvent.click(screen.getByRole('button', { name: /^Log filters/ }));
    const popup = screen.getByRole('dialog', { name: 'Log filters' });
    const log = within(popup).getByRole('radiogroup', { name: 'Chat layout' });
    expect(within(log).getByRole('radio', { name: /^Terminal/ })).toBeChecked();
    fireEvent.click(within(log).getByRole('radio', { name: /^Bubbles/ }));
    expect(onSave).toHaveBeenLastCalledWith('bubbles');
    expect(screen.getByTestId('layout')).toHaveTextContent('bubbles');
    expect(within(list).getByRole('radio', { name: /^Bubbles/ })).toBeChecked();
  });

  it('without a provider the control fails loudly instead of looking as if it worked', () => {
    const { result } = renderHook(() => useChatLayoutControl());
    expect(result.current.layout).toBe('rule');
    expect(() => result.current.setLayout('terminal')).toThrow(/no ChatLayoutProvider/);
  });
});
