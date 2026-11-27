import type { ReactNode } from 'react';
import type { ThreadAnchor } from '../deps.js';
import { ClampedBody } from './ClampedBody.js';
import { PLAIN_LABEL, type ChatLayout } from './chatLayouts.js';
import { MessageLead } from './MessageLead.js';
import { ThreadButton } from './ThreadButton.js';
import { TimeLabel } from './TimeLabel.js';
import type { RowModel } from './rowModel.js';
import { LOG_ICON, LOG_META } from './sizes.js';

/** Where a toolbar sits: on top of the message corner, shown on hover or focus; on a screen that cannot hover, in the flow under the text, always there. */
const TOOLBAR = 'absolute right-1 top-0 z-10 flex items-center gap-1 rounded border border-border bg-surface px-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100';
const TOOLBAR_TOUCH = '[@media(hover:none)]:static [@media(hover:none)]:justify-end [@media(hover:none)]:border-0 [@media(hover:none)]:bg-transparent [@media(hover:none)]:opacity-100';
const MAIN = 'flex min-w-0 flex-1 flex-col gap-1';
const GUTTER_TIME = 'w-[5ch] shrink-0 max-[480px]:hidden';
const GUTTER_NICK = 'w-[7ch] shrink-0 truncate text-xs font-semibold';

export interface ChatMessageProps {
  model: RowModel & { role: 'user' | 'assistant' };
  layout: ChatLayout;
  /** The content of the message (markdown, text, marks): the same for every layout. */
  body: ReactNode;
  now: number;
  /** The highlight ring of a located row. */
  ring: string;
  /** The row before is a message of the same sender. */
  continued: boolean;
  onThread?: (anchor: Extract<ThreadAnchor, { kind: 'ok' }>) => void;
}

function nickOf(label: string): string {
  return (label.split(/[\s,(]/)[0] ?? label).toLowerCase();
}

/**
 * One message of the conversation (yours or the agent): the container, the sender, the age, the marks, the thread action and the body, as the layout says. The
 * same parts and actions for every layout; the layout only moves them (see chatLayouts.ts).
 */
export function ChatMessage({ model, layout, body, now, ring, continued, onThread }: ChatMessageProps) {
  const role = model.role;
  const style = layout[role];
  const plain = model.label === PLAIN_LABEL[role];
  const interrupted = model.cue === 'interrupt';
  const grouped = continued && layout.groupSender && model.trailing === undefined && !interrupted && plain;
  const showHeader = style.header !== 'none' && !grouped;
  const gutter = style.lead === 'gutter';
  const timeAt = grouped ? 'hover' : style.time;
  const Icon = model.icon;
  const nameClass = model.tone === 'error' ? 'text-xs font-medium text-hue-red' : style.name;
  const thread = model.anchor !== undefined && onThread !== undefined ? <ThreadButton anchor={model.anchor} onThread={onThread} /> : null;
  const cueText = interrupted ? <span className="text-xs font-medium text-warning-text">interrupted the running step</span> : null;
  const time = <TimeLabel timestamp={model.timestamp} now={now} />;

  const header = showHeader ? (
    <div className={style.header === 'strip' ? style.strip : 'flex items-center gap-2'}>
      {style.header === 'strip' ? <Icon aria-hidden="true" className={`${LOG_ICON} ${model.iconClass}`} /> : null}
      <span className={nameClass}>{model.label}</span>
      {cueText}
      {timeAt === 'header' ? time : null}
      {model.trailing}
      {thread}
    </div>
  ) : null;

  // Without a name on the screen, the sender is read aloud; a label that says more than the plain name ("You (queued)", "You, via web") is shown.
  const named = showHeader || gutter || !plain;
  const status =
    !showHeader && (model.trailing !== undefined || interrupted || (!plain && !gutter)) ? (
      <div className="flex flex-wrap items-center gap-2">
        {plain || gutter ? null : <span className={`${LOG_META} text-muted`}>{model.label}</span>}
        {cueText}
        {model.trailing}
      </div>
    ) : null;
  // Time and thread of a message without a header line (and the thread of a gutter line).
  const inToolbar = !showHeader && (timeAt === 'hover' || thread !== null);
  const toolbar = inToolbar ? (
    <div data-chat-toolbar="" className={`${TOOLBAR} ${TOOLBAR_TOUCH}`}>
      {timeAt === 'hover' ? time : null}
      {thread}
    </div>
  ) : null;

  const content = (
    <>
      {named ? null : <span className="sr-only">{model.label}</span>}
      {header}
      {style.body === '' ? (
        <ClampedBody lines={style.clampLines}>{body}</ClampedBody>
      ) : (
        <div className={style.body}>
          <ClampedBody lines={style.clampLines}>{body}</ClampedBody>
        </div>
      )}
      {status}
      {toolbar}
    </>
  );
  const toneClass = interrupted ? layout.interrupt : style.tone;
  const cardClass = `${style.card} ${toneClass} ${model.tone === 'muted' ? 'opacity-80' : ''} ${ring}`;
  const rowClass = `${layout.column} ${style.outer} ${layout.groupSender && !grouped ? layout.groupStart : ''}`;
  return (
    <div data-chat-role={role} data-chat-grouped={grouped ? 'true' : undefined} className={rowClass}>
      <div className={cardClass}>
        {style.header === 'strip' || style.lead === 'none' ? (
          content
        ) : (
          <>
            {gutter ? (
              <span className={`flex shrink-0 items-baseline gap-2 ${style.leadClass}`}>
                <span className={GUTTER_TIME}>
                  <TimeLabel timestamp={model.timestamp} now={now} clock="minutes" />
                </span>
                <span aria-hidden="true" className={GUTTER_NICK}>
                  {nickOf(model.label)}
                </span>
                <span className="sr-only">{model.label}</span>
              </span>
            ) : (
              <MessageLead model={model} style={style} grouped={grouped} />
            )}
            <div className={MAIN}>{content}</div>
          </>
        )}
      </div>
    </div>
  );
}
