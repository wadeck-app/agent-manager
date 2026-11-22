import { ButtonAction } from '@wadeck-app/dsl-ui';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { dismissNotice, isDismissed, readDismissed, restoreNotices, type NoticeItem } from '../logic/notices.js';
import { NoticeRow, TONE_CLASS } from './NoticeRow.js';

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export interface NoticesView {
  /** The line (or the line of several notices with its list); null when nothing is visible. */
  line: ReactNode;
  /** The small button that says how many notices are dismissed and brings them back; null when none is. */
  badge: ReactNode;
}

/**
 * The compact notices of a page: ONE line however many problems there are. One notice shows its sentence; several show "N notices" and open a list. A
 * dismissal is remembered per message text for the browser session (a changed message comes back), and the badge keeps the dismissed ones one click away.
 */
export function useNotices(items: readonly NoticeItem[]): NoticesView {
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [listOpen, setListOpen] = useState(false);
  const dismiss = useCallback((item: NoticeItem): void => {
    if (item.onDismiss !== undefined) {
      item.onDismiss();
      return;
    }
    dismissNotice(item);
    setDismissed(readDismissed());
  }, []);
  const visible = useMemo(() => items.filter((item) => !isDismissed(item, dismissed)), [items, dismissed]);
  const hidden = items.length - visible.length;

  let line: ReactNode = null;
  if (visible.length === 1 && visible[0] !== undefined) {
    line = <NoticeRow item={visible[0]} onDismiss={dismiss} />;
  } else if (visible.length > 1) {
    const anyError = visible.some((item) => item.tone === 'error');
    line = (
      <div role={anyError ? 'alert' : 'status'} className={`rounded border px-2 py-1 text-sm ${TONE_CLASS[anyError ? 'error' : 'warning']}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TriangleAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
          <span className="min-w-0 flex-1 basis-40 font-medium">{`${visible.length} notices`}</span>
          <ButtonAction variant="secondary" size="sm" label={listOpen ? 'Hide' : 'Show'} onClick={() => setListOpen(!listOpen)} />
          <ButtonAction variant="secondary" size="sm" label="Dismiss all" onClick={() => visible.forEach(dismiss)} />
        </div>
        {listOpen ? (
          <div className="mt-1 flex flex-col gap-1" role="list">
            {visible.map((item) => (
              <div key={item.key} role="listitem">
                <NoticeRow item={item} bare onDismiss={dismiss} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const badge =
    hidden > 0 ? (
      <ButtonAction
        variant="secondary"
        size="sm"
        icon={<TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />}
        label={`${plural(hidden, 'notice', 'notices')} dismissed`}
        onClick={() => {
          restoreNotices();
          setDismissed([]);
        }}
      />
    ) : null;
  return { line, badge };
}

/** The notices of a page without a toolbar (Table, Guardrails): the line, and the badge under it when some are dismissed. */
export function NoticeStrip({ items }: { items: readonly NoticeItem[] }) {
  const { line, badge } = useNotices(items);
  if (line === null && badge === null) {
    return null;
  }
  return (
    <div className="flex flex-col items-start gap-1">
      {line !== null ? <div className="w-full">{line}</div> : null}
      {badge}
    </div>
  );
}
