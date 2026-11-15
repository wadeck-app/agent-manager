import { useCallback, useState } from 'react';

const STORAGE_KEY = 'agent-manager.collapsedGroups';

/** The saved choices ({ groupId: collapsed }), empty when nothing valid is saved. A storage that throws (private mode) means "nothing saved". */
export function readCollapsed(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  } catch {
    return {};
  }
}

function saveCollapsed(value: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Not saved: the groups open as by default after a reload. Nothing the user could fix, nothing worth an error banner.
  }
}

/**
 * Collapsed state per group, remembered in localStorage. `defaults` says which groups start collapsed until the user chooses (the choice then wins,
 * in both directions).
 */
export function useCollapsed(defaults: Readonly<Record<string, boolean>>): { isCollapsed: (id: string) => boolean; toggle: (id: string) => void } {
  const [saved, setSaved] = useState<Record<string, boolean>>(readCollapsed);
  const isCollapsed = useCallback((id: string): boolean => saved[id] ?? defaults[id] ?? false, [saved, defaults]);
  const toggle = useCallback(
    (id: string) =>
      setSaved((current) => {
        const next = { ...current, [id]: !(current[id] ?? defaults[id] ?? false) };
        saveCollapsed(next);
        return next;
      }),
    [defaults],
  );
  return { isCollapsed, toggle };
}
