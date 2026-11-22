import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { Info, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import type { NoticeItem, NoticeTone } from '../logic/notices.js';

export const TONE_CLASS: Record<NoticeTone, string> = {
  error: 'border-danger bg-danger-bg text-danger-text',
  warning: 'border-warning bg-warning-bg text-warning-text',
  info: 'border-border bg-info-bg text-info-text',
};

type CopyState = 'idle' | 'copied' | 'failed';

/** One notice on one line: icon, a short sentence, Copy fix, Details (the full text under the line), Dismiss. */
export function NoticeRow({ item, bare, onDismiss }: { item: NoticeItem; /** Inside the list of several notices: no role of its own (the list line carries it). */ bare?: boolean; onDismiss: (item: NoticeItem) => void }) {
  const [open, setOpen] = useState(false);
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
    <div {...(bare === true ? {} : { role: item.tone === 'error' ? 'alert' : 'status' })} data-notice={item.key} className={`rounded border px-2 py-1 text-sm ${TONE_CLASS[item.tone]}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
        <span className="min-w-0 flex-1 basis-40 break-words font-medium">{item.summary}</span>
        {item.action !== undefined ? <ButtonAction variant="secondary" size="sm" label={item.action.label} onClick={item.action.run} /> : null}
        {item.fix !== undefined ? <ButtonAction variant="secondary" size="sm" label="Copy fix" onClick={copyFix} /> : null}
        <ButtonAction variant="secondary" size="sm" label={open ? 'Hide details' : 'Details'} onClick={() => setOpen(!open)} />
        <IconButton variant="ghost" aria-label={`Dismiss: ${item.summary}`} icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={() => onDismiss(item)} />
      </div>
      <span aria-live="polite" className="block empty:hidden">
        {copy === 'copied' ? `Copied: ${item.fix}` : copy === 'failed' ? `Could not copy, type it yourself: ${item.fix}` : ''}
      </span>
      {open ? <p className="mt-1 break-words border-t border-current/30 pt-1 font-normal">{item.details}</p> : null}
    </div>
  );
}

