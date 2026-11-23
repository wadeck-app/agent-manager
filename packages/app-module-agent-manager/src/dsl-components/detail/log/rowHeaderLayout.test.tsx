import { render } from '@testing-library/react';
import { Layers } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { RowHeader } from './RowHeader.js';
import { TimeLabel } from './TimeLabel.js';
import type { RowModel } from './rowModel.js';

const model: RowModel = {
  key: 'g',
  role: 'tool',
  icon: Layers,
  iconClass: '',
  label: '2 tool calls',
  summary: 'Bash, Bash',
  tone: 'normal',
  expandable: true,
  body: null,
  trailing: <span data-testid="chips">2 bash 1 failed</span>,
};

// jsdom has no layout: the classes that make a narrow row wrap instead of overlap are what can be pinned.
describe('a collapsed log row on a narrow pane', () => {
  it('wraps the chips under the title instead of overlapping them, and never breaks a chip word by word', () => {
    const { container, getByTestId } = render(<RowHeader model={model} expandable open={false} onToggle={() => undefined} />);
    const header = container.querySelector('button') as HTMLElement;
    expect(header.className).toContain('flex-wrap');
    const holder = getByTestId('chips').parentElement as HTMLElement;
    expect(holder.className).toContain('ml-auto');
    expect(holder.className).toContain('shrink-0');
    expect(holder.className).toContain('whitespace-nowrap');
  });

  it('keeps a readable minimum for the summary so the chips wrap before it disappears', () => {
    const { container } = render(<RowHeader model={model} expandable open={false} onToggle={() => undefined} />);
    const summary = Array.from(container.querySelectorAll('span')).find((span) => span.textContent === 'Bash, Bash') as HTMLElement;
    expect(summary.className).toMatch(/min-w-\[/);
    expect(summary.className).toContain('truncate');
  });

  it('keeps the age on one line', () => {
    const { container } = render(<TimeLabel timestamp={1000} now={1_000_000} />);
    const time = container.querySelector('time') as HTMLElement;
    expect(time.className).toContain('whitespace-nowrap');
    expect(time.className).toContain('shrink-0');
  });
});
