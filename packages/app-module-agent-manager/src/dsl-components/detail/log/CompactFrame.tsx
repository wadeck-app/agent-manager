import { FOCUS_RING } from '../deps.js';
import { HIGHLIGHT, TONE_TEXT } from './frameStyles.js';
import type { FrameProps } from './frameTypes.js';
import { TimeLabel } from './TimeLabel.js';
import { LOG_ICON, LOG_MONO } from './sizes.js';

export function CompactFrame({ model, open, onToggle, context, now, highlighted }: FrameProps) {
  const Icon = model.icon;
  const hasBody = model.body !== null;
  return (
    <div className={`${LOG_MONO} ${highlighted ? HIGHLIGHT : ''}`}>
      <div className="flex min-w-0 items-center gap-2">
        <TimeLabel timestamp={model.timestamp} now={now} clock />
        {hasBody ? (
          <button type="button" aria-expanded={open} onClick={() => onToggle(model.key)} className={`flex min-w-0 flex-1 items-center gap-2 rounded text-left hover:bg-muted-bg ${FOCUS_RING}`}>
            <Icon aria-hidden="true" className={`${LOG_ICON} ${model.iconClass}`} />
            <span className={`w-24 shrink-0 truncate font-medium ${TONE_TEXT[model.tone]}`}>{model.label}</span>
            <span className={`min-w-0 flex-1 ${open ? 'whitespace-normal break-words' : 'truncate'} text-muted`}>{open ? '' : model.summary}</span>
            {model.trailing}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Icon aria-hidden="true" className={`${LOG_ICON} ${model.iconClass}`} />
            <span className={`w-24 shrink-0 truncate font-medium ${TONE_TEXT[model.tone]}`}>{model.label}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{model.summary}</span>
            {model.trailing}
          </div>
        )}
      </div>
      {open && hasBody ? <div className="ml-16 my-1 border-l-2 border-border pl-2 font-sans">{model.body?.(context)}</div> : null}
    </div>
  );
}
