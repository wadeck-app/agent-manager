import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_VARIANTS, SWITCH_READINESS, UI_QUESTIONS } from '../logic/uiVariants.js';
import { HandOverIcon } from './HandOverIcon.js';
import type { GlyphState, GlyphTarget } from './handOverShapes.js';

const STATES: readonly GlyphState[] = ['free', 'busy', 'unknown'];
const TARGETS: readonly GlyphTarget[] = ['hc', 'stream-json'];

function drawn(variant: (typeof SWITCH_READINESS)[number], state: GlyphState, target: GlyphTarget): SVGElement {
  const { container } = render(<HandOverIcon variant={variant} state={state} target={target} />);
  return container.querySelector('svg') as SVGElement;
}

describe('the hand-over icon', () => {
  it.each(SWITCH_READINESS)('%s: decorative, 24 grid, three different drawings for free, busy and unknown (for both destinations)', (variant) => {
    for (const target of TARGETS) {
      const html = STATES.map((state) => {
        const svg = drawn(variant, state, target);
        expect(svg).toHaveAttribute('aria-hidden', 'true');
        expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
        expect(svg).toHaveAttribute('data-handover-state', state);
        expect(svg).toHaveAttribute('data-handover-target', target);
        return svg.innerHTML;
      });
      expect(new Set(html).size, `${variant} to ${target}`).toBe(3);
    }
  });

  it.each(SWITCH_READINESS)('%s: no mask or id (the icon is drawn several times in a page), no text', (variant) => {
    for (const state of STATES) {
      const svg = drawn(variant, state, 'hc');
      expect(svg.querySelector('mask, [id], text')).toBeNull();
      expect(svg.textContent).toBe('');
    }
  });

  it('window: the destination host is drawn (a terminal prompt to the Terminal, a browser bar to the Web)', () => {
    const toTerminal = drawn('window', 'free', 'hc').innerHTML;
    const toWeb = drawn('window', 'free', 'stream-json').innerHTML;
    expect(toTerminal).not.toBe(toWeb);
    expect(toTerminal).toContain('m6.5 12.5 2.5 2.5-2.5 2.5');
    expect(toWeb).not.toContain('m6.5 12.5 2.5 2.5-2.5 2.5');
  });

  it('only a small part may take a tone: the busy window arrow, and nothing else in any look', () => {
    for (const variant of SWITCH_READINESS) {
      for (const state of STATES) {
        const tones = drawn(variant, state, 'hc').querySelectorAll('[class*="text-"]').length;
        expect(tones, `${variant} ${state}`).toBe(variant === 'window' && state === 'busy' ? 1 : 0);
      }
    }
  });

  it('Web <-> Terminal looks mirror: the session in the other host is drawn on the other side', () => {
    for (const variant of ['hop', 'pill'] as const) {
      expect(drawn(variant, 'free', 'hc').innerHTML).not.toBe(drawn(variant, 'free', 'stream-json').innerHTML);
      expect(drawn(variant, 'free', 'stream-json').querySelector('g')?.getAttribute('transform')).toContain('matrix(-1');
    }
  });
  it('Two slots (hop) is the default look, and the five looks stay in the dock', () => {
    expect(DEFAULT_UI_VARIANTS.switchReadiness).toBe('hop');
    expect(UI_QUESTIONS.switchReadiness.initial).toBe('hop');
    expect([...SWITCH_READINESS].sort()).toEqual(['hop', 'pill', 'plug', 'wheel', 'window']);
    expect(Object.keys(UI_QUESTIONS.switchReadiness.options).sort()).toEqual(['hop', 'pill', 'plug', 'wheel', 'window']);
  });

  // jsdom has no getBBox: the geometry is pinned from the attributes. The drawing fills the 24 grid like the lucide icons around it (measured in the browser: 14.67 px
  // wide and 14.65 px tall at 16 px, centred), not the 12 px of the first drawing.
  it('hop: the two slots span x 2..22 and y 9..22 and the arc starts above them, so the drawing is centred in the 24 grid', () => {
    const rects = [...drawn('hop', 'free', 'hc').querySelectorAll('rect')];
    expect(rects).toHaveLength(2);
    const [left, right] = rects.map((rect) => ({ x: Number(rect.getAttribute('x')), y: Number(rect.getAttribute('y')), w: Number(rect.getAttribute('width')), h: Number(rect.getAttribute('height')) }));
    expect(left!.x).toBe(2);
    expect(right!.x + right!.w).toBe(22);
    for (const slot of [left!, right!]) {
      expect(slot.y).toBe(9);
      expect(slot.y + slot.h).toBe(22);
    }
  });
});
