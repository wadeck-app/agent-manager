import { describe, expect, it } from 'vitest';
import { herdrLight, herdrRowShape, herdrTint, isHerdrDensity } from './herdrRow.js';

describe('the Herdr light of a state', () => {
  it('finished and unseen is a blue dot, working a spinner, needs you a red pill with words, idle a grey ring', () => {
    expect(herdrLight('done')).toEqual({ kind: 'dot', label: 'Finished, not seen yet' });
    expect(herdrLight('working')).toEqual({ kind: 'spinner', label: 'Working' });
    expect(herdrLight('needs-you')).toEqual({ kind: 'pill', label: 'Needs you' });
    expect(herdrLight('idle')).toEqual({ kind: 'ring', label: 'Idle' });
  });

  it('a state Herdr has no light for keeps the icon of the page (never an invented light)', () => {
    expect(herdrLight('other')).toEqual({ kind: 'icon', label: 'Other' });
    expect(herdrLight('ended')).toEqual({ kind: 'icon', label: 'Ended' });
  });
});

describe('the Herdr tint', () => {
  it('only the tinted variant tints: red for needs you, blue for finished and unseen, nothing for the quiet states', () => {
    expect(herdrTint('herdr-line', 'needs-you', false)).toBeUndefined();
    expect(herdrTint('herdr-name', 'done', false)).toBeUndefined();
    expect(herdrTint('herdr-tinted', 'needs-you', false)).toContain('--am-herdr-needs-bg');
    expect(herdrTint('herdr-tinted', 'done', false)).toContain('--am-herdr-unseen-bg');
    expect(herdrTint('herdr-tinted', 'idle', false)).toBeUndefined();
    expect(herdrTint('herdr-tinted', 'working', false)).toBeUndefined();
  });

  it('the open row of the tinted variant is a gold outline with a gold gradient, whatever its state', () => {
    for (const state of ['needs-you', 'done', 'idle'] as const) {
      const look = herdrTint('herdr-tinted', state, true);
      expect(look).toContain('--am-herdr-active-edge');
      expect(look).toContain('--am-herdr-active-bg');
    }
    expect(herdrTint('herdr-line', 'idle', true)).toBeUndefined();
  });
});

describe('the shape of a Herdr row', () => {
  it('knows its variants, shows the folder text on the line and tinted variants and hides it on the name only one', () => {
    expect(isHerdrDensity('compact')).toBe(false);
    expect(isHerdrDensity('herdr-line')).toBe(true);
    expect(herdrRowShape('herdr-line')).toEqual({ folder: true });
    expect(herdrRowShape('herdr-tinted')).toEqual({ folder: true });
    expect(herdrRowShape('herdr-name')).toEqual({ folder: false });
  });
});
