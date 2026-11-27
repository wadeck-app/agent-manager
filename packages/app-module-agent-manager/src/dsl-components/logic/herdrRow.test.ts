import { describe, expect, it } from 'vitest';
import { herdrLight, herdrRowShape, herdrTint, isHerdrDensity, stateRing, stateTint } from './herdrRow.js';

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

describe('the state tint', () => {
  it('red for needs you, blue for finished and unseen, orange for a flag, nothing for the quiet states; needs you wins over flagged over unseen (the order of the Herdr WAgents mod)', () => {
    expect(stateTint('needs-you', false)).toContain('--am-herdr-needs-bg');
    expect(stateTint('done', false)).toContain('--am-herdr-unseen-bg');
    expect(stateTint('idle', true)).toBe('bg-[color:var(--am-herdr-flag-bg)]');
    expect(stateTint('working', true)).toBe('bg-[color:var(--am-herdr-flag-bg)]');
    expect(stateTint('idle', false, true)).toContain('--am-herdr-unseen-bg');
    expect(stateTint('working', false, true)).toBeUndefined();
    expect(stateTint('needs-you', true)).toContain('--am-herdr-needs-bg');
    expect(stateTint('done', true)).toBe('bg-[color:var(--am-herdr-flag-bg)]');
    for (const state of ['idle', 'working', 'other', 'ended'] as const) {
      expect(stateTint(state, false)).toBeUndefined();
    }
  });
});

describe('the Herdr tint', () => {
  it('the state tint shows in every density (a choice of row shape never hides that an agent needs you)', () => {
    for (const density of ['compact', 'herdr-name', 'herdr-tinted'] as const) {
      expect(herdrTint(density, 'needs-you', false)).toContain('--am-herdr-needs-bg');
      expect(herdrTint(density, 'done', false)).toContain('--am-herdr-unseen-bg');
      expect(herdrTint(density, 'idle', false, true)).toBe('bg-[color:var(--am-herdr-flag-bg)]');
      expect(herdrTint(density, 'idle', false)).toBeUndefined();
      expect(herdrTint(density, 'working', false)).toBeUndefined();
    }
  });

  it('the open row of every Herdr row is a gold outline with a gold gradient, whatever its state, and keeps its state tint under it', () => {
    for (const density of ['herdr-tinted', 'herdr-name'] as const) {
      for (const state of ['needs-you', 'done', 'idle'] as const) {
        const look = herdrTint(density, state, true);
        expect(look).toContain('--am-herdr-active-edge');
        expect(look).toContain('--am-herdr-active-bg');
      }
    }
    expect(herdrTint('herdr-tinted', 'needs-you', true)).toContain('--am-herdr-needs-bg');
    expect(herdrTint('herdr-tinted', 'idle', true, true)).toContain('bg-[color:var(--am-herdr-flag-bg)]');
    // The compact row keeps its own open look (the list gives it).
    expect(herdrTint('compact', 'idle', true)).toBeUndefined();
    expect(herdrTint('compact', 'needs-you', true)).toBeUndefined();
  });
});

describe('the shape of a Herdr row', () => {
  it('knows its variants, shows the folder text on the line and tinted variants and hides it on the name only one', () => {
    expect(isHerdrDensity('compact')).toBe(false);
    expect(isHerdrDensity('herdr-tinted')).toBe(true);
    expect(herdrRowShape('herdr-tinted')).toEqual({ folder: true });
    expect(herdrRowShape('herdr-name')).toEqual({ folder: false });
  });
});

describe('stateRing (Q36)', () => {
  it('outlines the state tints with their hue, and has nothing for a row without a tint', () => {
    expect(stateRing('needs-you', false)).toContain('--am-herdr-needs-ring');
    expect(stateRing('working', true)).toContain('--am-herdr-flag-ring');
    expect(stateRing('done', false)).toContain('--am-herdr-unseen-ring');
    expect(stateRing('idle', false, true)).toContain('--am-herdr-unseen-ring');
    expect(stateRing('idle', false)).toBeUndefined();
  });
});
