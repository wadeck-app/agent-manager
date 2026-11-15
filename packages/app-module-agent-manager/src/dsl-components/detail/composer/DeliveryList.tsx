import { useDateFormat } from '@wadeck-app/dsl-ui';
import { ChevronDown, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { FOCUS_RING } from '../deps.js';
import type { DeliveryItem } from './deliveryItems.js';
import { DeliveryBadge } from './DeliveryBadge.js';

export function DeliveryList({ items }: { items: readonly DeliveryItem[] }) {
  const formatter = useDateFormat();
  const [open, setOpen] = useState(false);
  if (items.length === 0) {
    return null;
  }
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="text-xs">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`inline-flex items-center gap-1 rounded text-muted hover:text-content ${FOCUS_RING}`}>
        <Chevron aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
        Last messages ({items.length})
      </button>
      {open ? (
        <ul aria-label="Last messages" className="mt-1 flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.messageId} className="flex flex-col gap-0.5 rounded bg-muted-bg px-2 py-1">
              <div className="flex items-center gap-2">
                <DeliveryBadge ui={item.ui} reason={item.reason} />
                <span className="min-w-0 flex-1 truncate text-content" title={item.text}>
                  {item.text === '' ? 'Image only' : item.text}
                </span>
                {item.imageCount > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-muted">
                    <ImageIcon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
                    {item.imageCount}
                  </span>
                ) : null}
                <time className="shrink-0 tabular-nums text-muted" dateTime={new Date(item.at).toISOString()} title={formatter.exact(item.at)}>
                  {formatter.format(item.at, 'short', 'time')}
                </time>
              </div>
              {item.detail !== '' ? <p className={item.ui === 'failed' ? 'text-danger-text' : 'text-muted'}>{item.detail}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
