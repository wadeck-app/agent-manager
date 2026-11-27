import { describe, expect, it } from 'vitest';
import { footerClearance, overlaps, type Box } from './footerClearance.js';

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
// The 1280 x 800 case measured in the browser: list pane right edge 540, footer 240..540 x 759..800, popup 534..986 x 700..740.
const footer = box(240, 759, 540, 800);

describe('footerClearance', () => {
  it('does not overlap when the popup is above the footer (1280, popup over the detail pane): undefined, the popup keeps its place', () => {
    expect(overlaps(box(534, 700, 986, 740), footer)).toBe(false);
    expect(footerClearance(box(534, 700, 986, 740), footer, 800)).toBeUndefined();
  });

  it('does not overlap when only the horizontal ranges meet but the popup is clear above the footer', () => {
    expect(footerClearance(box(250, 600, 530, 700), footer, 800)).toBeUndefined();
  });

  it('does not overlap when only edges touch', () => {
    expect(overlaps(box(540, 759, 900, 800), footer)).toBe(false);
    expect(overlaps(box(250, 700, 530, 759), footer)).toBe(false);
  });

  it('overlaps when the popup spans the footer (390): popup bottom = footer top, as a distance from the window bottom', () => {
    const narrow = box(0, 700, 390, 780);
    expect(overlaps(narrow, box(0, 759, 390, 800))).toBe(true);
    expect(footerClearance(narrow, box(0, 759, 390, 800), 800)).toBe(41);
  });

  it('a sliver of a few pixels is not a cover: a popup that enters the footer pane by 6 px stays where it is (1280 without the dock)', () => {
    const sliver = box(534, 740, 986, 790);
    expect(overlaps(sliver, footer)).toBe(false);
    expect(footerClearance(sliver, footer, 800)).toBeUndefined();
    expect(overlaps(box(520, 740, 986, 790), footer)).toBe(true);
  });

  it('a footer that is not laid out (hidden pane, zero size) is never overlapped', () => {
    expect(footerClearance(box(0, 700, 390, 780), box(0, 0, 0, 0), 800)).toBeUndefined();
  });

  it('a popup that is not laid out is never an overlap', () => {
    expect(footerClearance(box(0, 0, 0, 0), footer, 800)).toBeUndefined();
  });
});
