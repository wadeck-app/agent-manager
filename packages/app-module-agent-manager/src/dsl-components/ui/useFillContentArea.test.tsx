import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { clampBleed, fillHeight, MAX_BLEED_PX, measureBleed, useFillContentArea } from './useFillContentArea.js';

// jsdom does not expand the `padding` shorthand in computed styles: each side is written out.
const SIDES_16 = { paddingTop: '16px', paddingRight: '16px', paddingBottom: '16px', paddingLeft: '16px' };

function Page({ crumbBefore = false }: { crumbBefore?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useFillContentArea(root, 100);
  return (
    <main>
      <div className="outer" style={SIDES_16}>
        <div className="inner" style={SIDES_16}>
          {crumbBefore ? <p>error badge</p> : null}
          <div ref={root} data-testid="root" />
        </div>
      </div>
    </main>
  );
}

describe('useFillContentArea', () => {
  it('stretches the element over the padding of the frames above it, up to the main element', () => {
    const { getByTestId } = render(<Page />);
    const style = getByTestId('root').style;
    expect([style.marginTop, style.marginRight, style.marginBottom, style.marginLeft]).toEqual(['-32px', '-32px', '-32px', '-32px']);
  });

  it('does not cover what comes before it: the top stays when a sibling precedes', () => {
    const { getByTestId } = render(<Page crumbBefore />);
    const style = getByTestId('root').style;
    expect(style.marginTop).toBe('0px');
    expect(style.marginLeft).toBe('-32px');
  });

  it('takes the height of the viewport below its top edge (at least the minimum)', () => {
    const { getByTestId } = render(<Page />);
    // jsdom has no layout: the top edge is 0, the viewport 768 px.
    expect(getByTestId('root').style.height).toBe(`${window.innerHeight}px`);
  });

  it('bounds the stretch and ignores a padding it cannot read', () => {
    expect(clampBleed(500)).toBe(MAX_BLEED_PX);
    expect(clampBleed(-4)).toBe(0);
    expect(clampBleed(Number.NaN)).toBe(0);
    const main = document.createElement('main');
    const frame = document.createElement('div');
    frame.style.paddingLeft = '200px';
    const element = document.createElement('div');
    frame.append(element);
    main.append(frame);
    document.body.append(main);
    expect(measureBleed(element, main).left).toBe(MAX_BLEED_PX);
    main.remove();
  });
});

describe('fillHeight', () => {
  it('fills what is left of the viewport below the element, at least the minimum', () => {
    expect(fillHeight(120, 0, 900, 360)).toBe(780);
    expect(fillHeight(800, 0, 900, 360)).toBe(360);
  });

  it('adds the scroll back: the same element scrolled by 40 px gets the same height as at the top', () => {
    const atTop = fillHeight(120, 0, 900, 100);
    const scrolled = fillHeight(120 - 40, 40, 900, 100);
    expect(scrolled).toBe(atTop);
    // Without the correction it would be 40 px too tall.
    expect(900 - (120 - 40)).toBe(atTop + 40);
  });
});

describe('useFillContentArea with a laid-out page', () => {
  function stubTop(top: number): () => void {
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
      return { x: 0, y: top, top, left: 0, right: 0, bottom: top, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
    };
    return () => {
      HTMLElement.prototype.getBoundingClientRect = original;
    };
  }

  it('measures the height from the top of the page, whatever the window is scrolled by', () => {
    const restore = stubTop(100);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 60 });
    try {
      const { getByTestId } = render(<Page />);
      // viewport 768, the element is 100 px below the viewport top while scrolled by 60: its place at the top of the page is 160.
      expect(getByTestId('root').style.height).toBe(`${window.innerHeight - 160}px`);
    } finally {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
      restore();
    }
  });

  it('does not write a style again when nothing changed (no resize feedback loop)', async () => {
    const restore = stubTop(100);
    try {
      const { getByTestId } = render(<Page />);
      const root = getByTestId('root');
      let writes = 0;
      const style = root.style;
      const heightSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(style), 'height')?.set;
      Object.defineProperty(style, 'height', {
        configurable: true,
        get: () => style.getPropertyValue('height'),
        set: (value: string) => {
          writes += 1;
          heightSetter?.call(style, value);
        },
      });
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
      expect(writes).toBe(0);
    } finally {
      restore();
    }
  });
});
