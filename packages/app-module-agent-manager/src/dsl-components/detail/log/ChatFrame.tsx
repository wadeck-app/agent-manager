import { HIGHLIGHT } from './frameStyles.js';
import type { FrameProps } from './frameTypes.js';
import { RowHeader } from './RowHeader.js';
import { TimeLabel } from './TimeLabel.js';

export function ChatFrame({ model, open, onToggle, context, now, highlighted }: FrameProps) {
  const expandable = model.expandable;
  const bodyOpen = !expandable || open;
  const body = bodyOpen && model.body !== null ? model.body(context) : null;
  const ring = highlighted ? HIGHLIGHT : '';
  if (model.role === 'user' || model.role === 'assistant') {
    const mine = model.role === 'user';
    return (
      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <div className={`flex max-w-am-prose flex-col gap-1 rounded-lg border px-3.5 py-2.5 ${model.cue === 'interrupt' ? 'border-warning bg-primary-light' : mine ? 'border-transparent bg-primary-light' : 'border-border bg-surface'} ${model.tone === 'muted' ? 'opacity-80' : ''} ${ring}`}>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${model.tone === 'error' ? 'text-hue-red' : 'text-muted'}`}>{model.label}</span>
            {model.cue === 'interrupt' ? <span className="text-xs font-medium text-warning-text">interrupted the running step</span> : null}
            <TimeLabel timestamp={model.timestamp} now={now} />
            {model.trailing}
          </div>
          {body}
        </div>
      </div>
    );
  }
  return (
    <div className={`rounded border border-transparent px-1 ${ring}`}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <RowHeader model={model} expandable={expandable} open={open} onToggle={() => onToggle(model.key)} />
        </div>
        <TimeLabel timestamp={model.timestamp} now={now} />
      </div>
      {open && body !== null ? <div className="ml-6 mb-1 rounded border border-border bg-bg p-2">{body}</div> : null}
    </div>
  );
}
