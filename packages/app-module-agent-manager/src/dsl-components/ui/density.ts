import { useSyncExternalStore } from 'react';

/**
 * The scale the page is drawn with: the CSS variables of one of these (styles/agents.css, `.agents-scope[data-density=...]`). `ml` ("Medium plus") sits between
 * M and L: the jump from 15 to 17 px text is too big for a window that is a little too wide for M and not wide enough for L.
 */
export type Density = 's' | 'm' | 'ml' | 'l';

/** What the user can choose: one scale, or `auto` (the scale follows the width of the window). */
export type DensitySetting = 'auto' | 's' | 'm' | 'l';

export const DENSITY_SETTINGS: readonly DensitySetting[] = ['auto', 's', 'm', 'l'];
/** The default: nothing chosen means the scale follows the screen (a stored S, M or L always wins). */
export const DEFAULT_SETTING: DensitySetting = 'auto';
export const DENSITY_STORAGE_KEY = 'agent-manager.density';
export const DENSITY_LABEL: Record<Density, string> = { s: 'Small', m: 'Medium', ml: 'Medium plus', l: 'Large' };

/** Window widths (CSS px) from which `auto` picks the bigger scale: below 1700 M, from 1700 M plus, from 2200 L (a 1440p monitor is 2560 wide). */
export const AUTO_ML_FROM_PX = 1700;
export const AUTO_L_FROM_PX = 2200;

/** The scale `auto` picks for a window of this width. */
export function resolveAuto(width: number): Density {
  return width >= AUTO_L_FROM_PX ? 'l' : width >= AUTO_ML_FROM_PX ? 'ml' : 'm';
}

/** The scale of a setting for a window of this width. */
export function resolveDensity(setting: DensitySetting, width: number): Density {
  return setting === 'auto' ? resolveAuto(width) : setting;
}

function isSetting(value: unknown): value is DensitySetting {
  return value === 'auto' || value === 's' || value === 'm' || value === 'l';
}

export const DENSITY_READ_PROBLEM = 'Your text size setting could not be read: the default (Auto) is used.';
export const DENSITY_WRITE_PROBLEM = 'Your text size could not be saved: it resets when the page is reloaded.';

/** The last problem with the saved setting, shown (dismissible) in the text size panel; empty when there is none. */
let storageProblem = '';
let warned = false;

function reportProblem(text: string, detail: unknown): void {
  storageProblem = text;
  if (!warned) {
    warned = true;
    console.warn(`[agent-manager] ${text}`, detail);
  }
}

/** The saved setting; the default when nothing is saved. A storage that throws, or a value that is not a setting, gives the default AND a visible note (never silent). */
export function readSetting(): DensitySetting {
  try {
    const saved = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (saved === null) {
      return DEFAULT_SETTING;
    }
    if (isSetting(saved)) {
      return saved;
    }
    reportProblem(DENSITY_READ_PROBLEM, saved);
    return DEFAULT_SETTING;
  } catch (error) {
    reportProblem(DENSITY_READ_PROBLEM, error);
    return DEFAULT_SETTING;
  }
}

const listeners = new Set<() => void>();
let current: DensitySetting | undefined;

function setting(): DensitySetting {
  current ??= readSetting();
  return current;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Applies and saves a setting. Every scope wrapper (the page and each portal) follows at once. */
export function setDensity(next: DensitySetting): void {
  current = next;
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
  } catch (error) {
    reportProblem(DENSITY_WRITE_PROBLEM, error);
  }
  notify();
}

/** Forgets the in-memory value so the next read goes to the storage again (tests). */
export function resetDensityCache(): void {
  current = undefined;
  storageProblem = '';
  warned = false;
  notify();
}

/** Another tab changed (or cleared) the saved setting: this tab follows. */
function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === DENSITY_STORAGE_KEY) {
    current = readSetting();
    notify();
  }
}

/** The window was resized: `auto` may now pick another scale (a subscriber only re-renders when the picked scale changes). */
function onResize(): void {
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener('storage', onStorage);
    window.addEventListener('resize', onResize);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('resize', onResize);
    }
  };
}

/** The scale in use. Computed from the window width on every read, so the first render already has the right one (no flash, no effect). */
export function useDensity(): Density {
  return useSyncExternalStore(
    subscribe,
    () => resolveDensity(setting(), window.innerWidth),
    () => 'm',
  );
}

/** The sentence to show when the saved text size could not be read or saved; empty otherwise. */
export function useDensityProblem(): string {
  return useSyncExternalStore(
    subscribe,
    () => storageProblem,
    () => '',
  );
}

/** The user dismissed the note. */
export function dismissDensityProblem(): void {
  storageProblem = '';
  notify();
}

/** The setting the user made (`auto` by default). */
export function useDensitySetting(): DensitySetting {
  return useSyncExternalStore(subscribe, setting, () => DEFAULT_SETTING);
}
