import { useSyncExternalStore } from 'react';

/** The text and icon scale of the page. The values per setting are CSS variables (styles/agents.css, `.agents-scope[data-density=...]`). */
export type Density = 's' | 'm' | 'l';

export const DENSITIES: readonly Density[] = ['s', 'm', 'l'];
export const DEFAULT_DENSITY: Density = 'm';
export const DENSITY_STORAGE_KEY = 'agent-manager.density';
export const DENSITY_LABEL: Record<Density, string> = { s: 'Small', m: 'Medium', l: 'Large' };

function isDensity(value: unknown): value is Density {
  return value === 's' || value === 'm' || value === 'l';
}

/** The saved setting; the default when nothing valid is saved. A storage that throws (private mode) means "nothing saved". */
export function readDensity(): Density {
  try {
    const saved = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    return isDensity(saved) ? saved : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
}

const listeners = new Set<() => void>();
let current: Density | undefined;

function snapshot(): Density {
  current ??= readDensity();
  return current;
}

/** Applies and saves a setting. Every scope wrapper (the page and each portal) follows at once. */
export function setDensity(next: Density): void {
  current = next;
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
  } catch {
    // Not saved: the setting resets on reload. Nothing the user could fix, nothing worth an error banner.
  }
  listeners.forEach((listener) => listener());
}

/** Forgets the in-memory value so the next read goes to the storage again (tests). */
export function resetDensityCache(): void {
  current = undefined;
  listeners.forEach((listener) => listener());
}

/** Another tab changed (or cleared) the saved setting: this tab follows, so two open tabs never show different sizes after a reload-free change. */
function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === DENSITY_STORAGE_KEY) {
    current = readDensity();
    listeners.forEach((listener) => listener());
  }
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('storage', onStorage);
    }
  };
}

export function useDensity(): Density {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_DENSITY);
}
