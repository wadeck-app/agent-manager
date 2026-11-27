import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hoverTip, liveTooltip } from '../detail/status/liveTooltip.js';
import { row } from '../logic/fixtures.js';
import { RowTip } from '../lists/RowTip.js';

/*
 * jsdom has no layout: the width of the card and the absence of overflow were measured with agent-browser on dsl-ui 2026.11.27-389 (the `rows` of its Tooltip, maxWidth sm,
 * activity clamped to 4 lines); here only what the module passes is checked.
 */
const LONG_COMMAND = 'Bash: _s="${USERPROFILE:-$HOME}/.claude/plugins/local-marketplace/plugins/w-guardrails/scripts"; node "$_s/request-bypass.js" --category git-write';

const FOLDER = '/work/billing';

describe('the tooltip of a list row', () => {
  it('shows the name, the folder and the activity as rows of the Tooltip, with the activity capped at 4 lines', () => {
    const session = row({ displayName: 'billing-owner', cwd: FOLDER });
    render(
      <RowTip session={session} line={LONG_COMMAND}>
        <button type="button">trigger</button>
      </RowTip>,
    );
    hoverTip(screen.getByRole('button', { name: 'trigger' }));
    const card = liveTooltip();
    expect(card.querySelector('dl')).not.toBeNull();
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
