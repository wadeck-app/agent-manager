import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { scrollCue, ScrollTable } from './ScrollTable.js';

describe('scrollCue', () => {
  it('says nothing when everything fits (or a rounding pixel is left)', () => {
    expect(scrollCue({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 })).toEqual({ start: false, end: false });
    expect(scrollCue({ scrollLeft: 0, clientWidth: 400, scrollWidth: 401 })).toEqual({ start: false, end: false });
  });

  it('points to the hidden side only', () => {
    expect(scrollCue({ scrollLeft: 0, clientWidth: 400, scrollWidth: 900 })).toEqual({ start: false, end: true });
    expect(scrollCue({ scrollLeft: 200, clientWidth: 400, scrollWidth: 900 })).toEqual({ start: true, end: true });
    expect(scrollCue({ scrollLeft: 500, clientWidth: 400, scrollWidth: 900 })).toEqual({ start: true, end: false });
  });
});

describe('ScrollTable', () => {
  it('is a real table inside a focusable, labelled scroll region with a minimum width (no column squeezed into one letter per line)', () => {
    render(
      <ScrollTable label="Things">
        <thead>
          <tr>
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>a</td>
          </tr>
        </tbody>
      </ScrollTable>,
    );
    const table = screen.getByRole('table', { name: 'Things' });
    expect(table.className).toContain('min-w-[40rem]');
    const region = screen.getByRole('region', { name: /Things/ });
    expect(region.contains(table)).toBe(true);
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.className).toContain('overflow-x-auto');
    // Measured root cause (QA3 R2): the absolute sr-only spans of the cells (tooltip texts) are not clipped by a static scroller and widen the page.
    expect(region.className.split(' ')).toContain('relative');
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeTruthy();
  });

  it('shows no cue while the table fits', () => {
    const { container } = render(
      <ScrollTable label="Things">
        <tbody />
      </ScrollTable>,
    );
    expect(container.querySelector('[data-scroll-cue]')).toBeNull();
    expect(screen.queryByText(/scroll sideways/i)).toBeNull();
  });

  it('shows a visible cue and a sentence when columns are hidden, and drops the end cue at the end', () => {
    const { container } = render(
      <ScrollTable label="Things">
        <tbody />
      </ScrollTable>,
    );
    const region = screen.getByRole('region', { name: /Things/ });
    Object.defineProperty(region, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(region, 'scrollWidth', { value: 900, configurable: true });
    fireEvent.scroll(region);
    expect(container.querySelector('[data-scroll-cue="end"]')).not.toBeNull();
    expect(container.querySelector('[data-scroll-cue="start"]')).toBeNull();
    expect(screen.getByText(/scroll sideways/i)).toBeTruthy();
    region.scrollLeft = 600;
    fireEvent.scroll(region);
    expect(container.querySelector('[data-scroll-cue="end"]')).toBeNull();
    expect(container.querySelector('[data-scroll-cue="start"]')).not.toBeNull();
  });
});
