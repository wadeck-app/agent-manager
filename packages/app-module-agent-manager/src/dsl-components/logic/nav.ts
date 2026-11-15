/** The id to select after a key, or undefined when the key is not a navigation key. `ids` is the visible order; `current` may be missing from it. */
export function navTarget(key: string, ids: readonly string[], current: string | undefined): string | undefined {
  if (ids.length === 0) {
    return undefined;
  }
  const index = current === undefined ? -1 : ids.indexOf(current);
  const last = ids.length - 1;
  const targets: Record<string, number> = {
    j: Math.min(last, index + 1),
    ArrowDown: Math.min(last, index + 1),
    k: Math.max(0, index === -1 ? 0 : index - 1),
    ArrowUp: Math.max(0, index === -1 ? 0 : index - 1),
    Home: 0,
    End: last,
  };
  const position = Object.hasOwn(targets, key) ? targets[key] : undefined;
  return position === undefined ? undefined : ids[position];
}

/** True when the target is an editable element: the single-letter shortcuts (j, k) must not steal its typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}
