import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { Info, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import type { NoticeItem, NoticeTone } from '../logic/notices.js';
import { prose } from '../logic/prose.js';

const FIX_COMMAND = 'min-w-0 break-all rounded bg-muted-bg px-1.5 py-0.5 font-mono text-am-mono text-content';

/** The severity icon colour (the row itself is flat, the tone is carried by the icon and the left edge). */
export const ICON_CLASS: Record<NoticeTone, string> = {
  error: 'text-danger-text',
  warning: 'text-warning-text',
  info: 'text-info-text',
};

/**
 * A 2 px left edge in the tone of the severity, and a divider above every row but the first. The colours are per side (`border-l-*`, `border-t-*`): a divide-y on the list would
 * paint the left edge of every row but the first in the divider colour.
 */
const EDGE_CLASS: Record<NoticeTone, string> = {
  error: 'border-l-danger',
  warning: 'border-l-warning',
  info: 'border-l-info-text',
};
const ROW_BOX = 'border-l-2 border-t border-t-border py-2 pl-2.5 pr-1.5 text-sm text-content first:border-t-0';

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * The details as the row shows them: when the row has a fix command (shown below with Copy fix), the "Fix: run `command`" sentence is left out of the text, so the fix is said once,
 * and no raw backtick is left.
 */
export function detailsText(item: Pick<NoticeItem, 'details' | 'fix'>): string {
  const text = item.fix === undefined ? item.details : item.details.replace(/\s*Fix: run `[^`]+`\.?/, '');
  return prose(text);
}

/**
 * One notice of the notices panel, flat (the panel draws the dividers): severity icon, a one-line title, the FULL detail text (selectable, long paths wrap),
 * the fix command with Copy fix when there is one, the action when there is one, and a dismiss button. Nothing is cut and nothing needs an extra click.
 */
export function NoticeRow({ item, onDismiss }: { item: NoticeItem; onDismiss: (item: NoticeItem) => void }) {
  const [copy, setCopy] = useState<CopyState>('idle');
  const Icon = item.tone === 'info' ? Info : TriangleAlert;
  const copyFix = (): void => {
    if (item.fix === undefined) {
      return;
    }
    navigator.clipboard.writeText(item.fix).then(
      () => setCopy('copied'),
      () => setCopy('failed'),
    );
  };
  return (
    <div role="listitem" data-notice={item.key} className={`${ROW_BOX} ${EDGE_CLASS[item.tone]}`}>
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className={`mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0 ${ICON_CLASS[item.tone]}`} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-5">{item.summary}</p>
          <p className="mt-0.5 break-words text-xs leading-5 text-content">{detailsText(item)}</p>
        </div>
        <IconButton variant="ghost" size="icon-xs" aria-label={`Dismiss: ${item.summary}`} icon={<X aria-hidden="true" className="h-3.5 w-3.5" />} onClick={() => onDismiss(item)} />
      </div>
      {item.fix !== undefined || item.action !== undefined ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
          {item.fix !== undefined ? <span className="text-xs text-muted">Fix:</span> : null}
          {item.fix !== undefined ? <code className={FIX_COMMAND}>{item.fix}</code> : null}
          {item.fix !== undefined ? <ButtonAction variant="secondary" size="sm" label="Copy fix" onClick={copyFix} /> : null}
          {item.action !== undefined ? <ButtonAction variant="secondary" size="sm" label={item.action.label} onClick={item.action.run} /> : null}
        </div>
      ) : null}
      <span aria-live="polite" className="block break-words pl-6 text-xs empty:hidden">
        {copy === 'copied' ? `Copied: ${item.fix}` : copy === 'failed' ? `Could not copy, type it yourself: ${item.fix}` : ''}
      </span>
    </div>
  );
}
