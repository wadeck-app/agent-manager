import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Scope } from './Scope.js';

/** Delay before a tooltip appears, so moving the pointer across a list shows none. Keyboard focus shows it at once. */
export const SHOW_DELAY_MS = 350;
const GAP = 8;
const MARGIN = 8;

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface Placement {
  top: number;
  left: number;
  side: TooltipSide;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where a tooltip of `size` goes around an `anchor`: on the preferred side, flipped to the opposite one when it does not fit in the viewport,
 * then clamped so it never leaves the viewport (the failure of the previous tooltips: clipped at the right edge). Pure, unit-tested.
 */
export function placeTooltip(anchor: Box, size: { width: number; height: number }, viewport: { width: number; height: number }, preferred: TooltipSide): Placement {
  const opposite: Record<TooltipSide, TooltipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const fits = (side: TooltipSide): boolean => {
    switch (side) {
      case 'top':
        return anchor.top - GAP - size.height >= MARGIN;
      case 'bottom':
        return anchor.top + anchor.height + GAP + size.height <= viewport.height - MARGIN;
      case 'left':
        return anchor.left - GAP - size.width >= MARGIN;
      case 'right':
        return anchor.left + anchor.width + GAP + size.width <= viewport.width - MARGIN;
      default:
        throw new Error(`placeTooltip: unknown side ${String(side)}`);
    }
  };
  const side = fits(preferred) ? preferred : fits(opposite[preferred]) ? opposite[preferred] : preferred;
  let top: number;
  let left: number;
  if (side === 'top' || side === 'bottom') {
    top = side === 'top' ? anchor.top - GAP - size.height : anchor.top + anchor.height + GAP;
    left = anchor.left + anchor.width / 2 - size.width / 2;
  } else {
    left = side === 'left' ? anchor.left - GAP - size.width : anchor.left + anchor.width + GAP;
    top = anchor.top + anchor.height / 2 - size.height / 2;
  }
  left = Math.max(MARGIN, Math.min(left, viewport.width - MARGIN - size.width));
  top = Math.max(MARGIN, Math.min(top, viewport.height - MARGIN - size.height));
  return { top, left, side };
}

// One tooltip at a time, whatever the number of anchors: opening one closes the one that is open.
let closeOpenTooltip: (() => void) | undefined;

export interface TooltipProps {
  /**
   * The text. Plain text only for the default variant: a tooltip never holds something the user must read or click. The 'card' variant takes labelled rows
   * (read only: it never takes the pointer, so nothing in it can be clicked either).
   */
  content: React.ReactNode;
  /** 'text' (default): the dark one-line bubble. 'card': a small surface card of fixed width for structured facts (sub-agent details). */
  variant?: 'text' | 'card';
  /** Layout of the wrapper around the child; the default shrinks to the child, a row that fills its list passes 'flex w-full min-w-0'. */
  anchorClassName?: string;
  /** Preferred side; flipped when it does not fit. */
  side?: TooltipSide;
  /** The element described: exactly one, it receives aria-describedby while the tooltip is shown. */
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
}

/**
 * Small tooltip rendered in a portal on the body with position: fixed, so no ancestor can clip it and it can never be stacked with another one.
 * Shown on pointer hover (after SHOW_DELAY_MS) and on keyboard focus (at once, only for :focus-visible), hidden on leave, blur, Escape, scroll and click.
 * Only one is shown at a time. It describes the element (aria-describedby) and is not the element's name: an icon button keeps its own aria-label.
 *
 * Not dsl-ui's Tooltip: that one is a non-portaled span shown by Tailwind `group-hover`, which matches ANY ancestor carrying `group` (see the report).
 */
export function Tooltip({ content, side = 'top', variant = 'text', anchorClassName = 'inline-flex min-w-0 max-w-full', children }: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | undefined>(undefined);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
    setPlacement(undefined);
  }, []);

  const show = useCallback(() => {
    closeOpenTooltip?.();
    closeOpenTooltip = hide;
    setOpen(true);
  }, [hide]);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(show, SHOW_DELAY_MS);
  }, [show]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (closeOpenTooltip === hide) {
        closeOpenTooltip = undefined;
      }
    },
    [hide],
  );

  // Measure after the bubble is in the DOM, before paint: no flash at the wrong place.
  useLayoutEffect(() => {
    if (!open || anchorRef.current === null || bubbleRef.current === null) {
      return;
    }
    const anchor = anchorRef.current.getBoundingClientRect();
    const bubble = bubbleRef.current.getBoundingClientRect();
    const next = placeTooltip(anchor, { width: bubble.width, height: bubble.height }, { width: window.innerWidth, height: window.innerHeight }, side);
    // The same place again (a card whose live text changed every second): no new state, no extra render.
    setPlacement((previous) => (previous !== undefined && previous.top === next.top && previous.left === next.left && previous.side === next.side ? previous : next));
  }, [open, content, side]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        hide();
      }
    };
    // A scrolled list moves the anchor: the tooltip would point at the wrong row.
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open, hide]);

  const onFocus = (event: React.FocusEvent<HTMLElement>): void => {
    // Keyboard focus only: a click focuses a button too and must not pop a tooltip over the next thing.
    let visible = true;
    try {
      const target = event.target as HTMLElement;
      // Only the element that really has the focus can be asked (a synthetic event on another element is shown).
      visible = target !== document.activeElement || target.matches(':focus-visible');
    } catch {
      // A browser without :focus-visible: show it, a tooltip too many is better than none for keyboard users.
    }
    if (visible) {
      clearTimeout(timer.current);
      show();
    }
  };

  const described = open ? React.cloneElement(children, { 'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' ') }) : children;

  return (
    <span ref={anchorRef} className={anchorClassName} onPointerEnter={schedule} onPointerLeave={hide} onFocus={onFocus} onBlur={hide} onPointerDown={hide}>
      {described}
      {open
        ? createPortal(
            <Scope>
              <div
                ref={bubbleRef}
                id={id}
                role="tooltip"
                data-side={placement?.side}
                // Fixed to the viewport, invisible until measured (so the first frame is not at 0,0).
                className={`pointer-events-none fixed left-0 top-0 z-50 shadow-lg ${variant === 'card' ? 'w-80 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-surface p-2 text-xs text-content' : 'w-max max-w-xs rounded bg-content px-2 py-1 text-xs text-bg'} ${placement === undefined ? 'invisible' : ''}`}
                style={placement === undefined ? undefined : { top: placement.top, left: placement.left }}
              >
                {content}
              </div>
            </Scope>,
            document.body,
          )
        : null}
    </span>
  );
}
