import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DENSITY, DENSITY_STORAGE_KEY, readDensity, resetDensityCache, setDensity } from './density.js';
import { DensityControl } from './DensityControl.js';
import { Scope } from './Scope.js';

beforeEach(() => {
  window.localStorage.clear();
  resetDensityCache();
});
afterEach(() => {
  window.localStorage.clear();
  resetDensityCache();
});

describe('density setting', () => {
  it('defaults to M, and an invalid saved value counts as nothing saved', () => {
    expect(DEFAULT_DENSITY).toBe('m');
    expect(readDensity()).toBe('m');
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'huge');
    expect(readDensity()).toBe('m');
  });

  it('is applied by the scope wrapper (data-density) and saved', () => {
    const { container } = render(
      <Scope>
        <p>content</p>
      </Scope>,
    );
    const scope = container.querySelector('.agents-scope');
    expect(scope).toHaveAttribute('data-density', 'm');
    act(() => setDensity('l'));
    expect(scope).toHaveAttribute('data-density', 'l');
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('l');
  });

  it('is read from the storage at start', () => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 's');
    resetDensityCache();
    const { container } = render(<Scope>x</Scope>);
    expect(container.querySelector('.agents-scope')).toHaveAttribute('data-density', 's');
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
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    // The checked one holds the focus and the tab stop.
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1] as HTMLElement, { key: 'ArrowDown' });
    expect(container.querySelector('.agents-scope')).toHaveAttribute('data-density', 'l');
    fireEvent.keyDown(screen.getAllByRole('radio')[2] as HTMLElement, { key: 'ArrowDown' });
    expect(container.querySelector('.agents-scope')).toHaveAttribute('data-density', 's');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe('toolbar', () => {
  it('holds the text size button and the shortcut help as icon buttons, inside the workspace box', async () => {
    const { Toolbar } = await import('../workspace/Toolbar.js');
    render(
      <Scope>
        <Toolbar count={3} hiddenDead={0} show="alive" onShow={() => undefined} helpOpen={false} onHelpOpenChange={() => undefined} />
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
    const scope = container.querySelector('.agents-scope');
    expect(scope).toHaveAttribute('data-density', 'm');
    // Another tab wrote the key: the browser fires `storage` here with the new value already in the storage.
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'l');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: DENSITY_STORAGE_KEY, newValue: 'l' }));
    });
    expect(scope).toHaveAttribute('data-density', 'l');
    // An unrelated key changes nothing.
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 's');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    });
    expect(scope).toHaveAttribute('data-density', 'l');
    window.localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(scope).toHaveAttribute('data-density', 'm');
  });
});

describe('popover hints', () => {
  it('are written from the table of sizes, the same three facts for every density', async () => {
    const { densityHint } = await import('./densityScale.js');
    expect(densityHint('s')).toBe('14 px text, 18 px icons, rows from 44 px');
    expect(densityHint('m')).toBe('15 px text, 20 px icons, rows from 52 px');
    expect(densityHint('l')).toBe('17 px text, 24 px icons, rows from 60 px');
    render(
      <Scope>
        <DensityControl />
      </Scope>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Text size' }));
    expect(screen.getByRole('radio', { name: /Small/ })).toHaveTextContent(densityHint('s'));
  });
});
