import type { ReactNode } from 'react';
import type { ThreadAnchor } from '../deps.js';
import { ClampedBody } from './ClampedBody.js';
import { PLAIN_LABEL, type ChatLayout } from './chatLayouts.js';
import { MessageLead } from './MessageLead.js';
import { ThreadButton } from './ThreadButton.js';
import { TimeLabel } from './TimeLabel.js';
import type { RowModel } from './rowModel.js';
import { LOG_META } from './sizes.js';

/** Where a toolbar sits: on top of the message corner, shown on hover or focus; on a screen that cannot hover, in the flow under the text, always there. */
const TOOLBAR = 'absolute right-1 top-0 z-10 flex items-center gap-1 rounded border border-border bg-surface px-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100';
const TOOLBAR_TOUCH = '[@media(hover:none)]:static [@media(hover:none)]:justify-end [@media(hover:none)]:border-0 [@media(hover:none)]:bg-transparent [@media(hover:none)]:opacity-100';
const MAIN = 'flex min-w-0 flex-1 flex-col gap-1';

export interface ChatMessageProps {
  model: RowModel & { role: 'user' | 'assistant' };
  layout: ChatLayout;
  /** The content of the message (markdown, text, marks): the same for every layout. */
  body: ReactNode;
  now: number;
  /** The highlight ring of a located row. */
  ring: string;
  onThread?: (anchor: Extract<ThreadAnchor, { kind: 'ok' }>) => void;
}

/**
 * One message of the conversation (yours or the agent): the container, the sender, the age, the marks, the thread action and the body, as the layout says. The
 * same parts and actions for every layout; the layout only moves them (see chatLayouts.ts).
 */
export function ChatMessage({ model, layout, body, now, ring, onThread }: ChatMessageProps) {
  const role = model.role;
  const style = layout[role];
  const plain = model.label === PLAIN_LABEL[role];
  const interrupted = model.cue === 'interrupt';
  const showHeader = style.header !== 'none';
  const nameClass = model.tone === 'error' ? 'text-xs font-medium text-hue-red' : style.name;
  const thread = model.anchor !== undefined && onThread !== undefined ? <ThreadButton anchor={model.anchor} onThread={onThread} /> : null;
  const cueText = interrupted ? <span className="text-xs font-medium text-warning-text">interrupted the running step</span> : null;
  const time = <TimeLabel timestamp={model.timestamp} now={now} />;

  const header = showHeader ? (
    <div className="flex items-center gap-2">
      <span className={nameClass}>{model.label}</span>
      {cueText}
      {style.time === 'header' ? time : null}
      {model.trailing}
      {thread}
    </div>
  ) : null;

  // Without a name on the screen, the sender is read aloud; a label that says more than the plain name ("You (queued)", "You, via web") is shown.
  const named = showHeader || !plain;
  const status =
    !showHeader && (model.trailing !== undefined || interrupted || !plain) ? (
      <div className="flex flex-wrap items-center gap-2">
        {plain ? null : <span className={`${LOG_META} text-muted`}>{model.label}</span>}
        {cueText}
        {model.trailing}
      </div>
    ) : null;
  // Time and thread of a message without a header line.
  const inToolbar = !showHeader && (style.time === 'hover' || thread !== null);
  const toolbar = inToolbar ? (
    <div data-chat-toolbar="" className={`${TOOLBAR} ${TOOLBAR_TOUCH}`}>
      {style.time === 'hover' ? time : null}
      {thread}
    </div>
  ) : null;

  const content = (
    <>
      {named ? null : <span className="sr-only">{model.label}</span>}
      {header}
      <ClampedBody lines={style.clampLines}>{body}</ClampedBody>
      {status}
      {toolbar}
    </>
  );
  const toneClass = interrupted ? layout.interrupt : style.tone;
  const cardClass = `${style.card} ${toneClass} ${model.tone === 'muted' ? 'opacity-80' : ''} ${ring}`;
  const rowClass = `${layout.column} ${style.outer}`;
  return (
    <div data-chat-role={role} className={rowClass}>
      <div className={cardClass}>
        {style.lead === 'none' ? (
          content
        ) : (
          <>
            <MessageLead style={style} />
            <div className={MAIN}>{content}</div>
          </>
        )}
      </div>
    </div>
  );
}
