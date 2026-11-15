import { HIGHLIGHT } from './frameStyles.js';
import type { FrameProps } from './frameTypes.js';
import { RowHeader } from './RowHeader.js';
import { TimeLabel } from './TimeLabel.js';

export function TimelineFrame({ model, open, onToggle, context, now, highlighted }: FrameProps) {
  const Icon = model.icon;
  const message = model.role === 'user' || model.role === 'assistant';
  const bodyOpen = !model.expandable || open;
  const body = bodyOpen && model.body !== null ? model.body(context) : null;
  return (
    <div className="grid grid-cols-[4.5rem_1.5rem_minmax(0,1fr)]">
      <div className="pt-1 text-right">
        <TimeLabel timestamp={model.timestamp} now={now} />
      </div>
      <div className="relative flex justify-center">
        <span aria-hidden="true" className="absolute inset-y-0 w-px bg-border" />
        <span className="relative z-10 mt-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-bg">
          <Icon aria-hidden="true" className={`h-3 w-3 shrink-0 ${model.iconClass}`} />
        </span>
      </div>
      <div className={`min-w-0 pb-3 pl-2 ${highlighted ? `rounded ${HIGHLIGHT}` : ''}`}>
        {message ? (
          <div className="flex flex-col gap-1 pt-0.5">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${model.tone === 'error' ? 'text-hue-red' : 'text-muted'}`}>{model.label}</span>
              {model.trailing}
            </div>
            {body}
          </div>
        ) : (
          <>
            <RowHeader model={model} expandable={model.expandable} open={open} onToggle={() => onToggle(model.key)} />
            {open && body !== null ? <div className="mt-1 rounded border border-border bg-surface p-2">{body}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}
