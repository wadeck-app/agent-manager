import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ICON_BUTTON_CLASS } from './IconButton.js';
import { Scope } from './Scope.js';

export interface ModalProps {
  title: string;
  /** Escape, the close button and a click on the backdrop call it. A modal that is busy ignores them through `dismissible`. */
  onClose: () => void;
  /** False while a request runs that must not be abandoned half way: Escape and the backdrop do nothing, the close button is disabled. */
  dismissible?: boolean;
  /** 'wide' for the launch form, 'narrow' for a confirmation. */
  size?: 'narrow' | 'wide';
  children: ReactNode;
}

/** The button row of a dialog: it sticks to the bottom of the scrolling body, so the buttons never fall below the fold (audit D10). */
export const DIALOG_FOOTER = 'sticky bottom-0 z-10 -mx-4 -mb-4 flex items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog rendered in a portal on the body (inside its own Scope wrapper, like the tooltips: the Tailwind rules are scoped, and no ancestor can clip it).
 * Focus goes into it when it opens, Tab stays inside, Escape closes, and the focus returns to what had it before.
 */
export function Modal({ title, onClose, dismissible = true, size = 'wide', children }: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (dismissibleRef.current) {
          onCloseRef.current();
        }
        return;
      }
      if (event.key === 'Tab' && panel.current !== null) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        const head = items[0];
        const tail = items[items.length - 1];
        if (head === undefined || tail === undefined) {
          return;
        }
        if (event.shiftKey && document.activeElement === head) {
          event.preventDefault();
          tail.focus();
        } else if (!event.shiftKey && document.activeElement === tail) {
          event.preventDefault();
          head.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      before?.focus();
    };
  }, []);

  return createPortal(
    <Scope>
      <div
        data-modal=""
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget && dismissible) {
            onClose();
          }
        }}
      >
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-surface text-content shadow-lg ${size === 'wide' ? 'max-w-3xl' : 'max-w-xl'}`}
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <h2 id={titleId} className="min-w-0 flex-1 text-base font-semibold">
              {title}
            </h2>
            <button type="button" aria-label="Close" disabled={!dismissible} onClick={onClose} className={ICON_BUTTON_CLASS}>
              <X aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        </div>
      </div>
    </Scope>,
    document.body,
  );
}
