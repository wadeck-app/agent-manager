import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hoverTip, liveTooltip } from '../detail/status/liveTooltip.js';
import { row } from '../logic/fixtures.js';
import { RowTip } from '../lists/RowTip.js';
import { TipRows } from './TipRows.js';

/*
 * jsdom has no layout: the rules that make the card fit its content are checked on the classes that carry them. The real widths (the card as wide as its text up to
 * the max width of the Tooltip, no overflow, 4 lines for the activity) were measured with agent-browser (poc/results/tip2/).
 */
const LONG_COMMAND = 'Bash: _s="${USERPROFILE:-$HOME}/.claude/plugins/local-marketplace/plugins/w-guardrails/scripts"; node "$_s/request-bypass.js" --category git-write';

const FOLDER = '/work/billing';

describe('TipRows', () => {
  it('lays the labels out in one fixed column and the values in a column that may shrink under a long word', () => {
    const { container } = render(<TipRows rows={[{ label: 'Name', value: 'a' }, { label: 'Folder', value: 'b' }]} />);
    const list = container.querySelector('dl');
    expect(list?.className).toContain('grid-cols-[auto_minmax(0,1fr)]');
    expect(list?.className).toContain('text-left');
    const labels = [...container.querySelectorAll('dt')];
    expect(labels.map((label) => label.textContent)).toEqual(['Name', 'Folder']);
    expect(labels.every((label) => label.className.includes('whitespace-nowrap'))).toBe(true);
  });

  it('left aligns every value and breaks a word with no space anywhere', () => {
    const { container } = render(<TipRows rows={[{ label: 'Folder', value: LONG_COMMAND }]} />);
    const value = container.querySelector('dd');
    expect(value?.className).toContain('text-left');
    expect(value?.className).toContain('[overflow-wrap:anywhere]');
    expect(value?.className).toContain('min-w-0');
    expect(value?.className).not.toContain('text-right');
  });

  it('caps a clamped value at 4 lines and leaves the others free', () => {
    const { container } = render(
      <TipRows
        rows={[
          { label: 'Folder', value: 'x' },
          { label: 'Activity', value: LONG_COMMAND, clamp: true },
        ]}
      />,
    );
    const values = [...container.querySelectorAll('dd')];
    expect(values[0]?.className).not.toContain('line-clamp');
    expect(values[1]?.className).toContain('line-clamp-4');
  });

  it('shows a note under the rows, and a note alone with no empty grid above it', () => {
    const { container, rerender } = render(<TipRows rows={[{ label: 'a', value: 'b' }]} note="Click to open" />);
    expect(container.querySelector('dl')).not.toBeNull();
    expect(screen.getByText('Click to open').className).toContain('mt-1.5');
    rerender(<TipRows rows={[]} note="Alone" />);
    expect(container.querySelector('dl')).toBeNull();
    expect(screen.getByText('Alone').className).not.toContain('mt-1.5');
  });
});

describe('the tooltip of a list row', () => {
  it('shows the name, the folder and the activity through TipRows, with the activity capped', () => {
    const session = row({ displayName: 'billing-owner', cwd: FOLDER });
    render(
      <RowTip session={session} line={LONG_COMMAND}>
        <button type="button">trigger</button>
      </RowTip>,
    );
    hoverTip(screen.getByRole('button', { name: 'trigger' }));
    const card = liveTooltip();
    expect(card.querySelector('[data-tip-rows]')).not.toBeNull();
    const facts = Object.fromEntries([...card.querySelectorAll('dt')].map((label) => [label.textContent ?? '', label.nextElementSibling]));
    expect(Object.keys(facts)).toEqual(['Name', 'Folder', 'Activity']);
    expect(facts.Name?.textContent).toBe('billing-owner');
    expect(facts.Folder?.textContent).toBe(FOLDER);
    expect(facts.Activity?.textContent).toBe(LONG_COMMAND);
    expect(facts.Activity?.className).toContain('line-clamp-4');
  });

  it('has no Activity row when the row has nothing to say', () => {
    render(
      <RowTip session={row({ displayName: 'a', cwd: '/work/x' })}>
        <button type="button">trigger</button>
      </RowTip>,
    );
    hoverTip(screen.getByRole('button', { name: 'trigger' }));
    expect([...liveTooltip().querySelectorAll('dt')].map((label) => label.textContent)).toEqual(['Name', 'Folder']);
  });
});
