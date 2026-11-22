import { MessageSquareShare } from 'lucide-react';
import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { useUiVariant } from '../deps.js';
import type { ThreadAnchor } from '../deps.js';

/**
 * The small "Thread" action of a message row: opens a side thread that knows the conversation up to this message. A message that cannot be an anchor shows the
 * button off, with the reason in its tooltip (never a control that silently is not there).
 */
export function ThreadButton({ anchor, onThread }: { anchor: ThreadAnchor; onThread: (anchor: Extract<ThreadAnchor, { kind: 'ok' }>) => void }) {
  const blocked = anchor.kind === 'blocked';
  const placement = useUiVariant('threadPlacement');
  // 'hover' and 'labelled' show on the hover or the focus of the message (the bubble is a `group`), and always on a screen without hover (touch). A focused button is always visible.
  const reveal = placement === 'always' ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100';
  // The wrapper carries the reveal: the base buttons take no opacity class of ours.
  return (
    <span className={`inline-flex shrink-0 ${reveal} focus-within:opacity-100`}>
      {placement === 'labelled' ? (
        <ButtonAction variant="secondary" size="sm" disabled={blocked} disabledReason={blocked ? `Thread: ${anchor.reason}` : undefined} onClick={() => anchor.kind === 'ok' && onThread(anchor)} icon={<MessageSquareShare aria-hidden="true" className="h-3.5 w-3.5" />} label="Thread" />
      ) : (
        <IconButton
          size="icon-sm"
          aria-label="Thread"
          title={blocked ? `Thread: ${anchor.reason}` : 'Thread: ask a side question that knows the conversation up to this message'}
          disabled={blocked}
          disabledReason={blocked ? `Thread: ${anchor.reason}` : undefined}
          onClick={() => anchor.kind === 'ok' && onThread(anchor)}
          icon={<MessageSquareShare aria-hidden="true" className="h-3.5 w-3.5" />}
        />
      )}
    </span>
  );
}
