import { Tooltip, useDateFormat } from '@wadeck-app/dsl-ui';
import type { ReactElement } from 'react';
import { Scope, TIP_FILL } from '../deps.js';
import { subagentFacts } from './subagentFacts.js';
import type { SubagentItem } from './subagentModel.js';

/**
 * The hover and focus card of a sub-agent, the dsl-ui Tooltip with labelled rows (its `rows`): name, type, model, status with its reason, times, tokens, cost, context. A row that has
 * no value says "Not available" and why. A live value (duration of a running one) is a text node that changes in place: the card is never remounted, so it does not flicker.
 *
 * The card is portaled out of our scope and has a fixed dark surface in both themes, so the values use the white tints of the card (never the page's semantic text colours,
 * unreadable on it); the Scope puts our utilities (the module sheet is scoped) back on the value nodes. The row with the clickable button is the trigger: the wrapper of the Tooltip fills the list (TIP_FILL).
 */
export function SubagentTip({ item, now, children }: { item: SubagentItem; now: number; children: ReactElement }) {
  const formatter = useDateFormat();
  // "26 Nov, 10:42:07" in the locale of the app.
  const clock = (at: number): string => formatter.intl({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(at);
  const rows = subagentFacts(item, now, clock).map((fact) => ({
    label: fact.label,
    value: (
      <Scope>
        <span data-subagent-fact="" className={`block font-medium tabular-nums ${fact.missing === true ? 'text-white/70' : ''}`}>
          {fact.value}
        </span>
        {fact.note === undefined ? null : <span className="block font-normal text-white/70">{fact.note}</span>}
      </Scope>
    ),
  }));
  return (
    <Tooltip side="left" className={TIP_FILL} rows={rows} maxWidth="sm">
      {children}
    </Tooltip>
  );
}
