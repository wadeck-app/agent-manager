import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { FOCUS_RING } from '../deps.js';
import { countStatuses } from './subagentModel.js';
import { SubagentsTitle } from './SubagentsTitle.js';
import { SubagentsView, type SubagentsViewProps } from './SubagentsView.js';

/** Layout `strip`: one line above the log that opens in place (the content scrolls inside a bounded height). */
export function SubagentDrawerStrip(props: SubagentsViewProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const counts = countStatuses(props.items);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section aria-label="Sub-agents" className="shrink-0 border-b border-border">
      <button type="button" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted-bg ${FOCUS_RING}`}>
        <Chevron aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
        <SubagentsTitle counts={counts} />
      </button>
      {open ? (
        <div id={panelId} className="max-h-[45vh] overflow-y-auto overscroll-contain border-t border-border">
          <SubagentsView {...props} />
        </div>
      ) : null}
    </section>
  );
}
