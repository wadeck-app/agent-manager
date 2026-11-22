import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { dismissNotice, isDismissed, readDismissed, restoreNotices, worstTone, type NoticeItem, type StoreResult } from '../logic/notices.js';
import { NoticeRow } from './NoticeRow.js';
import { usePopover } from './usePopover.js';

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** Colour of the icon and of the count badge, by the worst severity of the active notices. */
const BUTTON_TONE: Record<'error' | 'warning' | 'info', string> = {
  error: 'text-danger-text',
  warning: 'text-warning-text',
  info: 'text-info-text',
};

/** The corner badge by severity: tinted token pair, a border of the severity, and a ring in the surface colour that separates it from the icon under it. */
const BADGE_TONE: Record<'error' | 'warning' | 'info', string> = {
  error: 'border-danger bg-danger-bg text-danger-text',
  warning: 'border-warning bg-warning-bg text-warning-text',
  info: 'border-border bg-info-bg text-info-text',
};

/** One or two digits fit the 16 px badge; above 9 it reads "9+" (the button name keeps the real number). */
const badgeText = (count: number): string => (count > 9 ? '9+' : String(count));

const notRemembered = (result: StoreResult): string => (result.stored ? '' : result.reason);

/**
 * The notices of a page behind ONE icon button (a warning triangle with a count), shown only while at least one notice is active. The panel under it lists
 * them as compact rows. A dismissal is remembered per message text for the browser session (a changed message comes back); when the browser refuses to
 * store it the panel says so (the notice stays hidden until the next reload).
 */
export function NoticesButton({ items }: { items: readonly NoticeItem[] }) {
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [problem, setProblem] = useState('');
  const { open, setOpen, box, panelId } = usePopover('[role="dialog"]');
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
            {/* Inside the button box (top right, where the triangle has no ink): never clipped, never over the neighbour. */}
            <span data-notice-count="" aria-hidden="true" className={`pointer-events-none absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border px-0.5 text-[11px] font-semibold leading-none tabular-nums ring-2 ring-surface ${BADGE_TONE[tone]}`}>
              {badgeText(visible.length)}
            </span>
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
          // Narrow screens: spans the window below the button; from sm: hangs from the right edge of the button. Scrolls when long, never wider than the window.
          className="fixed inset-x-2 z-30 outline-none mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:w-96 sm:max-w-[calc(100vw-1rem)]"
        >
          {problem !== '' ? (
            <p role="alert" className="mb-2 rounded border border-warning bg-warning-bg px-2 py-1 text-xs text-warning-text">
              {`Not remembered: this browser refuses to store the dismissal (${problem}). The notice comes back after a reload.`}
            </p>
          ) : null}
          <div role="list" className="flex flex-col gap-1.5">
            {visible.map((item) => (
              <NoticeRow key={item.key} item={item} onDismiss={dismiss} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
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
            <ButtonAction variant="secondary" size="sm" label="Dismiss all" onClick={() => visible.forEach(dismiss)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
