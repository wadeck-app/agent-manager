import { MessageSquareShare } from 'lucide-react';
import { FOCUS_RING, Tooltip } from '../deps.js';
import type { ThreadAnchor } from '../deps.js';
import { LOG_ICON_SM } from './sizes.js';

/**
 * The small "Thread" action of a message row: opens a side thread that knows the conversation up to this message. A message that cannot be an anchor shows the
 * button off, with the reason in its tooltip (never a control that silently is not there).
 */
export function ThreadButton({ anchor, onThread }: { anchor: ThreadAnchor; onThread: (anchor: Extract<ThreadAnchor, { kind: 'ok' }>) => void }) {
  const blocked = anchor.kind === 'blocked';
  return (
    <Tooltip content={blocked ? `Thread: ${anchor.reason}` : 'Thread: ask a side question that knows the conversation up to this message'}>
      <button
        type="button"
        aria-label="Thread"
        disabled={blocked}
        onClick={() => {
          if (anchor.kind === 'ok') {
            onThread(anchor);
          }
        }}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-muted-bg hover:text-content disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
      >
        <MessageSquareShare aria-hidden="true" className={LOG_ICON_SM} />
      </button>
    </Tooltip>
  );
}
