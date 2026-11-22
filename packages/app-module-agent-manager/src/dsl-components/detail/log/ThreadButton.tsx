import { MessageSquareShare } from 'lucide-react';
import { IconButton } from '@wadeck-app/dsl-ui';
import type { ThreadAnchor } from '../deps.js';

export const THREAD_TOOLTIP = 'Start a thread from this message';

/**
 * The Thread action of a message row: always visible, at the top right of the row (the row puts it last and pushes it to the right edge). Opens a side thread
 * that knows the conversation up to this message. A message that cannot be an anchor shows the button off, with the reason in its tooltip (never a control that
 * is not there without explanation).
 */
export function ThreadButton({ anchor, onThread }: { anchor: ThreadAnchor; onThread: (anchor: Extract<ThreadAnchor, { kind: 'ok' }>) => void }) {
  const blocked = anchor.kind === 'blocked';
  return (
    <span data-thread-action="" className="ml-auto inline-flex shrink-0">
      <IconButton
        size="icon-sm"
        aria-label="Thread"
        title={blocked ? `Thread: ${anchor.reason}` : THREAD_TOOLTIP}
        disabled={blocked}
        disabledReason={blocked ? `Thread: ${anchor.reason}` : undefined}
        onClick={() => anchor.kind === 'ok' && onThread(anchor)}
        icon={<MessageSquareShare aria-hidden="true" className="h-3.5 w-3.5" />}
      />
    </span>
  );
}
