import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const MARGIN = 8;

/**
 * A small panel at a point of the window (a context menu, a settings popover): fixed, so a scrolling list does not clip it, and kept inside the window.
 * Escape or a press outside closes it and the focus goes back to what had it; the focus moves into the panel when it opens (`data-autofocus` first).
 */
export function FloatingPanel({ x, y, width = 260, label, onClose, children }: { x: number; y: number; width?: number; label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y });
  const close = useRef(onClose);
  close.current = onClose;

  // Measured once it is drawn: pushed left and up when it would leave the window.
  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect();
    const height = rect?.height ?? 0;
    setPlace({ left: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)), top: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)) });
  }, [x, y, width]);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('button, input, [tabindex]');
    target?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
    };
    const onPointer = (event: PointerEvent): void => {
      if (box.current !== null && event.target instanceof Node && !box.current.contains(event.target)) {
        close.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      if (before?.isConnected === true) {
        before.focus();
      }
    };
  }, []);

  return (
    <div ref={box} role="dialog" aria-label={label} style={{ position: 'fixed', left: place.left, top: place.top, width }} className="z-50 flex flex-col gap-1 rounded-lg border border-border bg-surface p-2 text-sm shadow-lg">
      {children}
    </div>
  );
}
