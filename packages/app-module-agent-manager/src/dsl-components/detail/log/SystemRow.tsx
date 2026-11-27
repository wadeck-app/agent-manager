import { Tooltip, useDateFormat } from '@wadeck-app/dsl-ui';
import { ChevronDown, ChevronRight, TriangleAlert, Webhook } from 'lucide-react';
import { FOCUS_RING, RowButton, chipClass } from '../deps.js';
import type { FrameProps } from './frameTypes.js';
import type { RowModel } from './rowModel.js';
import { LOG_META } from './sizes.js';
import { footerText, type SystemModel } from './systemModel.js';
import { TooltipLines } from './TooltipLines.js';

/** The strip is pulled up against the message it follows (the gap of the column is the room between rows, a strip belongs to the row above it). */
const STRIP_CLASS = '-mt-1';
const STRIP_BUTTON = `flex w-full min-w-0 flex-wrap items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted-bg ${FOCUS_RING}`;
const FOOTER_BUTTON = `flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0 text-left ${LOG_META} hover:bg-muted-bg ${FOCUS_RING}`;

/**
 * The looks "footer" and "chips" of the hook rows: no header row and no age column (the age is in the tooltip). Both are one button that opens the individual
 * lines under it (the same lines as the look "rows"); a failure is red (the text says it too: "failed", "cancelled").
 */
export function SystemRow({ model, system, open, onToggle, context, column }: Pick<FrameProps, 'open' | 'onToggle' | 'context'> & { model: RowModel; system: SystemModel; column: string }) {
  const formatter = useDateFormat();
  const Chevron = open ? ChevronDown : ChevronRight;
  const Icon = system.failed ? TriangleAlert : Webhook;
  const when = model.timestamp === undefined ? undefined : formatter.exact(model.timestamp);
  const body = open && model.body !== null ? model.body(context) : null;
  const inside =
    system.look === 'footer' ? (
      <>
        <Chevron aria-hidden="true" className="h-3 w-3 shrink-0 text-muted" />
        <Icon aria-hidden="true" className={`h-3 w-3 shrink-0 ${system.failed ? 'text-hue-red' : 'text-muted'}`} />
        <span className={`min-w-0 truncate ${system.failed ? 'text-hue-red' : 'text-muted'}`}>{footerText(system.parts)}</span>
      </>
    ) : (
      <>
        <Chevron aria-hidden="true" className="h-3 w-3 shrink-0 text-muted" />
        {system.parts.map((part) => (
          <Tooltip key={part.id} content={<TooltipLines text={part.tip} />}>
            <span data-system-chip={part.kind} className={chipClass(part.failed ? 'danger' : 'neutral', 'xs')}>
              {part.failed ? <TriangleAlert aria-hidden="true" className="h-3 w-3 shrink-0" /> : null}
              <span className="truncate">{part.chip}</span>
            </span>
          </Tooltip>
        ))}
      </>
    );
  return (
    <div data-system-look={system.look} className={`${column} ${system.look === 'chips' ? STRIP_CLASS : ''}`}>
      <Tooltip content={when}>
        <RowButton type="button" aria-expanded={open} aria-label={`${model.label} ${model.summary}`} onClick={() => onToggle(model.key)} className={system.look === 'footer' ? FOOTER_BUTTON : STRIP_BUTTON}>
          {inside}
        </RowButton>
      </Tooltip>
      {body !== null ? <div className="ml-6 mb-1 rounded border border-border bg-bg p-2">{body}</div> : null}
    </div>
  );
}
