import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_L_FROM_PX,
  AUTO_ML_FROM_PX,
  DEFAULT_SETTING,
  DENSITY_STORAGE_KEY,
  readSetting,
  resetDensityCache,
  resolveAuto,
  resolveDensity,
  setDensity,
} from './density.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { DensityControl } from './DensityControl.js';
import { autoHint, densityHint } from './densityScale.js';
import { Scope } from './Scope.js';

const REAL_WIDTH = window.innerWidth;

function setWindowWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

beforeEach(() => {
  window.localStorage.clear();
  resetDensityCache();
});
afterEach(() => {
  setWindowWidth(REAL_WIDTH);
  window.localStorage.clear();
  resetDensityCache();
});

function scopeOf(container: HTMLElement): HTMLElement {
  const scope = container.querySelector<HTMLElement>('.agents-scope');
  if (scope === null) {
    throw new Error('no scope wrapper rendered');
  }
  return scope;
}

describe('density setting', () => {
  it('defaults to auto, and an invalid saved value counts as nothing saved', () => {
    expect(DEFAULT_SETTING).toBe('auto');
    expect(readSetting()).toBe('auto');
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'huge');
    expect(readSetting()).toBe('auto');
  });

  it('auto picks M below 1700 px, M plus from 1700 px, L from 2200 px; a chosen scale ignores the width', () => {
    expect(resolveAuto(AUTO_ML_FROM_PX - 1)).toBe('m');
    expect(resolveAuto(AUTO_ML_FROM_PX)).toBe('ml');
    expect(resolveAuto(AUTO_L_FROM_PX - 1)).toBe('ml');
    expect(resolveAuto(AUTO_L_FROM_PX)).toBe('l');
    expect(resolveDensity('s', 2560)).toBe('s');
    expect(resolveDensity('m', 2560)).toBe('m');
    expect(resolveDensity('auto', 2560)).toBe('l');
  });

  it('is applied by the scope wrapper (data-density) and saved', () => {
    const { container } = render(
      <Scope>
        <p>content</p>
      </Scope>,
    );
    expect(scopeOf(container)).toHaveAttribute('data-density', 'm');
    act(() => setDensity('l'));
    expect(scopeOf(container)).toHaveAttribute('data-density', 'l');
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('l');
  });

  it('is computed from the window width on the very first render (no flash), and follows a resize', () => {
    setWindowWidth(2560);
    const { container } = render(<Scope>x</Scope>);
    expect(scopeOf(container)).toHaveAttribute('data-density', 'l');
    act(() => {
      setWindowWidth(1900);
      window.dispatchEvent(new Event('resize'));
    });
    expect(scopeOf(container)).toHaveAttribute('data-density', 'ml');
    act(() => {
      setWindowWidth(1440);
      window.dispatchEvent(new Event('resize'));
    });
    expect(scopeOf(container)).toHaveAttribute('data-density', 'm');
  });

  it('a stored S, M or L wins over the width', () => {
    setWindowWidth(2560);
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 's');
    resetDensityCache();
    const { container } = render(<Scope>x</Scope>);
    expect(scopeOf(container)).toHaveAttribute('data-density', 's');
    act(() => {
      setWindowWidth(1200);
      window.dispatchEvent(new Event('resize'));
    });
    expect(scopeOf(container)).toHaveAttribute('data-density', 's');
  });

  it('is changed from the keyboard in the popover of the toolbar button, and Escape gives the focus back', () => {
    const { container } = render(
      <Scope>
        <DensityControl />
      </Scope>,
    );
    const button = screen.getByRole('button', { name: 'Text size' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
    // The checked one (Auto, the default) holds the focus and the tab stop.
    expect(document.activeElement).toBe(radios[0]);
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowDown' });
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('s');
    expect(scopeOf(container)).toHaveAttribute('data-density', 's');
    fireEvent.keyDown(screen.getAllByRole('radio')[1] as HTMLElement, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getAllByRole('radio')[2] as HTMLElement, { key: 'ArrowDown' });
    expect(scopeOf(container)).toHaveAttribute('data-density', 'l');
    // Around the end: back to Auto.
    fireEvent.keyDown(screen.getAllByRole('radio')[3] as HTMLElement, { key: 'ArrowDown' });
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('auto');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('the popover says what Auto currently is', () => {
    setWindowWidth(2560);
    render(
      <Scope>
        <DensityControl />
      </Scope>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Text size' }));
    expect(screen.getAllByRole('radio')[0]).toHaveTextContent('Auto (currently Large)');
    act(() => {
      setWindowWidth(1800);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getAllByRole('radio')[0]).toHaveTextContent('Auto (currently Medium plus)');
  });
});

describe('toolbar', () => {
  it('holds the text size button and the shortcut help as icon buttons, inside the workspace box', async () => {
    const { Toolbar } = await import('../workspace/Toolbar.js');
    render(
      <Scope>
        <Toolbar
          count={3}
          hiddenDead={0}
          show="alive"
          onShow={() => undefined}
          mode="tree"
          onMode={() => undefined}
          options={DEFAULT_VIEW_OPTIONS}
          onOptions={() => undefined}
          search={{ text: '', onText: () => undefined, shown: 3, total: 3, problems: [], onMove: () => undefined, onEnter: () => undefined }}
          helpOpen={false}
          onHelpOpenChange={() => undefined}
          onNewSession={() => undefined}
        />
      </Scope>,
    );
    expect(screen.getByRole('button', { name: 'Text size' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agents' }).parentElement?.className).toContain('border-b');
  });
});

describe('density across tabs', () => {
  it('follows a change made in another tab (storage event), and a cleared storage', () => {
    const { container } = render(<Scope>x</Scope>);
    expect(scopeOf(container)).toHaveAttribute('data-density', 'm');
    // Another tab wrote the key: the browser fires `storage` here with the new value already in the storage.
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'l');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: DENSITY_STORAGE_KEY, newValue: 'l' }));
    });
    expect(scopeOf(container)).toHaveAttribute('data-density', 'l');
    // An unrelated key changes nothing.
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 's');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    });
    expect(scopeOf(container)).toHaveAttribute('data-density', 'l');
    window.localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(scopeOf(container)).toHaveAttribute('data-density', 'm');
  });
});

describe('popover hints', () => {
  it('are written from the table of sizes, the same three facts for every scale', () => {
    expect(densityHint('s')).toBe('14 px text, 18 px icons, rows from 44 px');
    expect(densityHint('m')).toBe('15 px text, 20 px icons, rows from 52 px');
    expect(densityHint('ml')).toBe('16 px text, 22 px icons, rows from 56 px');
    expect(densityHint('l')).toBe('17 px text, 24 px icons, rows from 60 px');
    expect(autoHint()).toBe('Follows the window: Medium plus from 1700 px wide, Large from 2200 px');
    render(
      <Scope>
        <DensityControl />
      </Scope>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Text size' }));
    expect(screen.getByRole('radio', { name: /^Small/ })).toHaveTextContent(densityHint('s'));
    expect(screen.getByRole('radio', { name: /Auto/ })).toHaveTextContent(autoHint());
  });
});

describe('density storage problems are said, not swallowed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetDensityCache();
  });

  it('an unknown saved value gives Auto, a console warning and a note in the popover that can be dismissed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'huge');
    resetDensityCache();
    render(
      <Scope>
        <DensityControl />
      </Scope>,
    );
    const button = screen.getByRole('button', { name: /Text size/ });
    expect(button).toHaveAccessibleName('Text size (a note about the saved setting)');
    fireEvent.click(button);
    expect(screen.getByRole('alert')).toHaveTextContent('Your text size setting could not be read: the default (Auto) is used.');
    expect(warn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the note about the text size' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a setting that cannot be saved is said, and still applies for the session', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <Scope>
        <DensityControl />
      </Scope>,
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Text size' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Small/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByRole('radio', { name: /^Small/ })).toHaveAttribute('aria-checked', 'true');
  });
});
