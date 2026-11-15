import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * The scrolling body of a list column. A row can move to another group while it holds the keyboard focus (a Done session marked seen goes to Idle): the
 * browser drops the focus of a removed element, so the focus is put back on the selected row when it was in the list and is now nowhere.
 */
export function ListScroll({ children, label, role = 'listbox', onKeyDown }: { children: ReactNode; label: string; role?: 'listbox' | 'tree'; onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);
  useLayoutEffect(() => {
    if (hadFocus.current && document.activeElement === document.body) {
      box.current?.querySelector<HTMLElement>('[aria-selected="true"][data-nav-item]')?.focus();
    }
  });
  return (
    <div
      ref={box}
      role={role}
      aria-label={label}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      onFocus={() => {
        hadFocus.current = true;
      }}
      onBlur={(event) => {
        const target = event.target;
        // A blur caused by the removal of the element is not the user leaving: only a blur of an element that is still in the page counts.
        queueMicrotask(() => {
          if (target.isConnected) {
            hadFocus.current = false;
          }
        });
      }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      {children}
    </div>
  );
}
