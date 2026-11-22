import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { Info, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { DETAILS_SHORT_MAX, shortDetails, type NoticeItem, type NoticeTone } from '../logic/notices.js';

export const TONE_CLASS: Record<NoticeTone, string> = {
  error: 'border-danger bg-danger-bg text-danger-text',
  warning: 'border-warning bg-warning-bg text-warning-text',
  info: 'border-border bg-info-bg text-info-text',
};

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * One notice as a compact row of the notices panel: icon, title, a short detail text (More shows it whole), Copy fix and the action when there are some, and a
 * dismiss button.
 */
export function NoticeRow({ item, onDismiss }: { item: NoticeItem; onDismiss: (item: NoticeItem) => void }) {
  const [whole, setWhole] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const Icon = item.tone === 'info' ? Info : TriangleAlert;
  const cut = item.details.length > DETAILS_SHORT_MAX;
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
    <div role="listitem" data-notice={item.key} className={`rounded border px-2 py-1.5 text-sm ${TONE_CLASS[item.tone]}`}>
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium">{item.summary}</p>
          <p className="mt-0.5 break-words text-xs font-normal">{whole || !cut ? item.details : shortDetails(item.details)}</p>
        </div>
        <IconButton variant="ghost" size="icon-xs" aria-label={`Dismiss: ${item.summary}`} icon={<X aria-hidden="true" className="h-3.5 w-3.5" />} onClick={() => onDismiss(item)} />
      </div>
      {cut || item.fix !== undefined || item.action !== undefined ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 pl-6">
          {cut ? <ButtonAction variant="secondary" size="sm" label={whole ? 'Less' : 'More'} onClick={() => setWhole(!whole)} /> : null}
          {item.action !== undefined ? <ButtonAction variant="secondary" size="sm" label={item.action.label} onClick={item.action.run} /> : null}
          {item.fix !== undefined ? <ButtonAction variant="secondary" size="sm" label="Copy fix" onClick={copyFix} /> : null}
        </div>
      ) : null}
      <span aria-live="polite" className="block pl-6 text-xs empty:hidden">
        {copy === 'copied' ? `Copied: ${item.fix}` : copy === 'failed' ? `Could not copy, type it yourself: ${item.fix}` : ''}
      </span>
    </div>
  );
}
