import { IconButton } from '@wadeck-app/dsl-ui';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Scope } from './Scope.js';
import { POPUP_SURFACE } from './popupSurface.js';

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

const FIELD_FOCUSABLE = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog rendered in a portal on the body (inside its own Scope wrapper, like the tooltips: the Tailwind rules are scoped, and no ancestor can clip it).
 * Focus goes into it when it opens, Tab stays inside, Escape closes, and the focus returns to what had it before. The focus starts on the element marked
 * `data-autofocus`, else on the first field of the body, else on the first control of the body (a confirmation), and on the Close button only when the body
 * has nothing to focus: the Close button comes first in the document, and a dialog that opened on it showed its tooltip over the title (QA3 R15).
 */
export function Modal({ title, onClose, dismissible = true, size = 'wide', children }: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    // data-autofocus marks the element to focus, or a wrapper of it (the base buttons take no data attribute).
    const marked = panel.current?.querySelector<HTMLElement>('[data-autofocus]');
    const first =
      marked === null || marked === undefined
        ? (body.current?.querySelector<HTMLElement>(FIELD_FOCUSABLE) ?? body.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE))
        : marked.matches(FOCUSABLE)
          ? marked
          : marked.querySelector<HTMLElement>(FOCUSABLE);
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
          className={`flex max-h-full w-full flex-col overflow-hidden ${POPUP_SURFACE} text-content ${size === 'wide' ? 'max-w-3xl' : 'max-w-xl'}`}
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <h2 id={titleId} className="min-w-0 flex-1 text-base font-semibold">
              {title}
            </h2>
            <IconButton size="icon-sm" aria-label="Close" disabled={!dismissible} onClick={onClose} icon={<X aria-hidden="true" className="h-4 w-4" />} />
          </div>
          <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {children}
          </div>
        </div>
      </div>
    </Scope>,
    document.body,
  );
}
