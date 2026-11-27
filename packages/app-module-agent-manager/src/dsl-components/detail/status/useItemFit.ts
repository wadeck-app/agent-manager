import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { fitRows } from './lineFit.js';

/** Width reserved for the "+N" chip when it is not drawn yet. */
const MORE_FALLBACK = 40;

interface Fit {
  key: string;
  shown: ReadonlySet<string>;
  second: ReadonlySet<string>;
  tight: boolean;
}

/** Bumps when the web fonts finish loading: a chip measured with the fallback font has another width afterwards. */
function useFontsReady(): number {
  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (fonts === undefined || fonts.status === 'loaded') {
      return undefined;
    }
    let live = true;
    void fonts.ready.then(() => {
      if (live) {
        setTick((value) => value + 1);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return tick;
}

/**
 * Which droppable chips of a one-line row stay, measured on the real row: every chip is drawn once (the "measuring" pass, before the browser paints), its
 * natural width is read, then `fitItems` keeps the best-priority ones that fit next to the "+N" chip. Children of the row tell what they are: a chip has
 * `data-line-item`, the "+N" chip `data-line-more`, everything else (name, state, age) is the base that always stays. `tight` is true when even the base
 * does not fit (the name may then shrink and the state become an icon). It measures again when the row width, the fonts or the `signature` change.
 * Without a layout (a test DOM, a row of width 0) every chip is shown: nothing is guessed.
 */
export function useItemFit(keys: readonly string[], order: readonly string[], signature: string): { ref: RefObject<HTMLDivElement | null>; shown: ReadonlySet<string>; second: ReadonlySet<string>; tight: boolean } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const fonts = useFontsReady();
  const [fit, setFit] = useState<Fit | null>(null);
  const key = `${width}|${fonts}|${signature}`;
  const current = fit !== null && fit.key === key ? fit : null;

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => setWidth(Math.round(element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (current !== null) {
      return;
    }
    const element = ref.current;
    if (element === null || element.clientWidth === 0) {
      setFit({ key, shown: new Set(keys), second: new Set(), tight: false });
      return;
    }
    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
    const children = Array.from(element.children) as HTMLElement[];
    const widths: Record<string, number> = {};
    let baseCount = 0;
    let base = 0;
    let more = MORE_FALLBACK;
    for (const child of children) {
      // The screen reader only copy of a dsl-ui Tooltip text is a sibling of its trigger: out of the flow (absolute), so not part of the base.
      if (child.getAttribute('role') === 'tooltip') {
        continue;
      }
      const own = child.getBoundingClientRect().width;
      const name = child.dataset['lineItem'];
      if (name !== undefined) {
        widths[name] = own;
      } else if (child.dataset['lineMore'] !== undefined) {
        more = own;
      } else {
        baseCount += 1;
        base += own;
      }
    }
    const baseTotal = base + gap * Math.max(0, baseCount - 1);
    // The second row is as wide as the header (the parent of the line): the actions are not on it.
    const secondAvailable = element.parentElement?.clientWidth ?? 0;
    if (baseTotal > element.clientWidth + 1) {
      setFit({ key, shown: new Set(), second: fitRows({ available: 0, secondAvailable, widths, order, gap, moreWidth: more }).second, tight: true });
      return;
    }
    const rows = fitRows({ available: element.clientWidth - baseTotal, secondAvailable, widths, order, gap, moreWidth: more });
    setFit({ key, shown: rows.first, second: rows.second, tight: false });
  });

  return { ref, shown: current === null ? new Set(keys) : current.shown, second: current === null ? new Set<string>() : current.second, tight: current?.tight ?? false };
}
