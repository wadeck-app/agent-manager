import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { dismissNotice, isDismissed, readDismissed, restoreNotices, worstTone, type NoticeItem, type StoreResult } from '../logic/notices.js';
import { CountBadge, type CountTone } from './CountBadge.js';
import { NoticeRow } from './NoticeRow.js';
import { usePopover } from './usePopover.js';
import { POPUP_SURFACE } from './popupSurface.js';

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** Colour of the icon and of the count badge, by the worst severity of the active notices. */
const BUTTON_TONE: Record<'error' | 'warning' | 'info', string> = {
  error: 'text-danger-text',
  warning: 'text-warning-text',
  info: 'text-info-text',
};

/** The corner badge by severity: tinted token pair, a border of the severity, and a ring in the surface colour that separates it from the icon under it. */
const BADGE_TONE: Record<'error' | 'warning' | 'info', CountTone> = { error: 'danger', warning: 'warning', info: 'info' };

/** One or two digits fit the 16 px badge; above 9 it reads "9+" (the button name keeps the real number). */
const badgeText = (count: number): string => (count > 9 ? '9+' : String(count));

/** The panel width as a class and as a number: 520 px, or the window minus a 12 px margin each side. Keep both in step. */
const PANEL_WIDTH = 'w-[min(520px,calc(100vw-1.5rem))]';
const PANEL_MAX = 520;
const WINDOW_MARGIN = 12;

/**
 * The `left` of the panel, relative to the button box it hangs from: right-aligned to the button, moved right when that would leave the window on the left
 * (a button near the left edge) and left when it would leave on the right. Measured when the panel opens and when the window is resized.
 */
function useAnchorOffset(open: boolean, box: RefObject<HTMLDivElement | null>): number {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const measure = (): void => {
      const rect = box.current?.getBoundingClientRect();
      if (rect === undefined) {
        return;
      }
      const width = Math.min(PANEL_MAX, window.innerWidth - 2 * WINDOW_MARGIN);
      const rightAligned = rect.width - width;
      const mostRight = window.innerWidth - WINDOW_MARGIN - width - rect.left;
      const mostLeft = WINDOW_MARGIN - rect.left;
      setOffset(Math.max(mostLeft, Math.min(rightAligned, mostRight)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, box]);
  return offset;
}

const notRemembered =(result: StoreResult): string => (result.stored ? '' : result.reason);

/**
 * The notices of a page behind ONE icon button (a warning triangle with a count), shown only while at least one notice is active. The panel under it lists
 * them as compact rows. A dismissal is remembered per message text for the browser session (a changed message comes back); when the browser refuses to
 * store it the panel says so (the notice stays hidden until the next reload).
 */
export function NoticesButton({ items }: { items: readonly NoticeItem[] }) {
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [problem, setProblem] = useState('');
  const { open, setOpen, box, panelId } = usePopover('[role="dialog"]');
  const offset = useAnchorOffset(open, box);
  const remember = useCallback((result: StoreResult): void => {
    const reason = notRemembered(result);
    if (reason !== '') {
      setProblem(reason);
    }
  }, []);
  const dismiss = useCallback(
    (item: NoticeItem): void => {
      if (item.onDismiss !== undefined) {
        item.onDismiss();
        return;
      }
      remember(dismissNotice(item));
      setDismissed((previous) => [...previous.filter((entry) => entry !== item.details), item.details]);
    },
    [remember],
  );
  const visible = useMemo(() => items.filter((item) => !isDismissed(item, dismissed)), [items, dismissed]);
  const hidden = items.filter((item) => isDismissed(item, dismissed)).length;
  if (visible.length === 0) {
    return null;
  }
  const tone = worstTone(visible);
  const count = plural(visible.length, 'notice', 'notices');
  return (
    <div ref={box} data-notices="" className="relative">
      <IconButton
        size="icon-sm"
        variant={open ? 'neutral' : 'ghost'}
        aria-label={count}
        title={count}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        className={`relative ${BUTTON_TONE[tone]}`}
        icon={
          <>
            <TriangleAlert aria-hidden="true" className="h-4 w-4" />
            {/* On the top right corner, half outside the 28 px button so the triangle stays readable (the toolbar has room above and beside it, nothing clips it). */}
            <CountBadge data-notice-count="" aria-hidden="true" tone={BADGE_TONE[tone]} className="pointer-events-none absolute -right-1 -top-1 ring-2 ring-surface">
              {badgeText(visible.length)}
            </CountBadge>
          </>
        }
      />
      {/* Announced without opening the panel: an error assertively, the rest politely. */}
      <span role={tone === 'error' ? 'alert' : 'status'} className="sr-only">
        {count}
      </span>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notices"
          tabIndex={-1}
          // An overlay out of the flow, anchored under the button: `left` (measured, see useAnchorOffset) right-aligns it to the button and keeps it in the window.
          className={`absolute top-full z-30 mt-1 flex max-h-[70vh] ${PANEL_WIDTH} flex-col overflow-hidden ${POPUP_SURFACE} text-content outline-none`}
          style={{ left: offset }}
        >
          {problem !== '' ? (
            <p role="alert" className="m-2 rounded border border-warning bg-warning-bg px-2 py-1 text-xs text-warning-text">
              {`Not remembered: this browser refuses to store the dismissal (${problem}). The notice comes back after a reload.`}
            </p>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div role="list" className="flex flex-col divide-y divide-border">
              {visible.map((item) => (
                <NoticeRow key={item.key} item={item} onDismiss={dismiss} />
              ))}
            </div>
          </div>
          {hidden > 0 || visible.length > 1 ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-2 py-1.5">
              {hidden > 0 ? (
                <ButtonAction
                  variant="secondary"
                  size="sm"
                  label={`Restore ${hidden} dismissed`}
                  onClick={() => {
                    remember(restoreNotices());
                    setDismissed([]);
                  }}
                />
              ) : null}
              {visible.length > 1 ? <ButtonAction variant="secondary" size="sm" label="Dismiss all" onClick={() => visible.forEach(dismiss)} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
