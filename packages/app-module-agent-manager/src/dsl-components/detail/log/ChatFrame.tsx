import { useChatLayout } from '../deps.js';
import { ChatMessage } from './ChatMessage.js';
import { CHAT_LAYOUTS } from './chatLayouts.js';
import { HIGHLIGHT } from './frameStyles.js';
import type { FrameProps } from './frameTypes.js';
import { RowHeader } from './RowHeader.js';
import type { RowModel } from './rowModel.js';
import { TimeLabel } from './TimeLabel.js';

function isMessage(model: RowModel): model is RowModel & { role: 'user' | 'assistant' } {
  return model.role === 'user' || model.role === 'assistant';
}

export function ChatFrame({ model, open, onToggle, context, now, highlighted, onThread }: FrameProps) {
  const layout = CHAT_LAYOUTS[useChatLayout()];
  const expandable = model.expandable;
  const bodyOpen = !expandable || open;
  const body = bodyOpen && model.body !== null ? model.body(context) : null;
  const ring = highlighted ? HIGHLIGHT : '';
  if (isMessage(model)) {
    return <ChatMessage model={model} layout={layout} body={body} now={now} ring={ring} {...(onThread === undefined ? {} : { onThread })} />;
  }
  return (
    <div className={`${layout.column} rounded border border-transparent px-1 ${ring}`}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <RowHeader model={model} expandable={expandable} open={open} onToggle={() => onToggle(model.key)} />
        </div>
        <TimeLabel timestamp={model.timestamp} now={now} />
      </div>
      {open && expandable && body !== null ? <div className="ml-6 mb-1 rounded border border-border bg-bg p-2">{body}</div> : null}
    </div>
  );
}
