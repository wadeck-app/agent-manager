import { useEffect, useId, useRef, useState } from 'react';
import { FOCUS_RING } from '../deps.js';
import { countStatuses } from './subagentModel.js';
import { SubagentsTitle } from './SubagentsTitle.js';
import { SubagentsView, type SubagentsViewProps } from './SubagentsView.js';

/**
 * Layout `badge`: a badge at the right of a thin bar above the log; it opens a popover over the log. Escape or a click outside closes it and the focus returns to
 * the badge. Choosing a sub-agent closes it, so the log behind shows the call that was asked for.
 */
export function SubagentBadge(props: SubagentsViewProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const box = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const counts = countStatuses(props.items);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        box.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus();
      }
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    const onPointer = (event: PointerEvent): void => {
      if (box.current !== null && event.target instanceof Node && !box.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div ref={box} className="relative flex shrink-0 justify-end border-b border-border px-3 py-1">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)} className={`rounded border border-border px-2 py-1 hover:bg-muted-bg ${open ? 'bg-muted-bg' : ''} ${FOCUS_RING}`}>
        <SubagentsTitle counts={counts} />
      </button>
      {open ? (
        <div id={panelId} role="dialog" aria-label="Sub-agents" className="absolute right-3 top-full z-30 mt-1 max-h-[60vh] w-[min(34rem,calc(100%-1.5rem))] overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface shadow-lg">
          <SubagentsView
            {...props}
            onSelect={(agentId) => {
              setOpen(false);
              props.onSelect(agentId);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
