import { useDateFormat } from '@wadeck-app/dsl-ui';
import { subagentFacts } from './subagentFacts.js';
import type { SubagentItem } from './subagentModel.js';

/**
 * The content of the hover and focus card of a sub-agent: labelled rows (name, type, model, status with its reason, times, tokens, cost, context). A row that has
 * no value says "Not available" and why. A live value (duration of a running one) is a text node that changes in place: the card is never remounted, so it does not flicker.
 */
export function SubagentCard({ item, now }: { item: SubagentItem; now: number }) {
  const formatter = useDateFormat();
  // "26 Nov, 10:42:07" in the locale of the app.
  const clock = (at: number): string => formatter.intl({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(at);
  const facts = subagentFacts(item, now, clock);
  return (
    <dl data-subagent-card="" className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-muted">{fact.label}</dt>
          <dd className="min-w-0 break-words">
            <span className={`font-medium tabular-nums ${fact.missing === true ? 'text-muted' : (fact.tone ?? 'text-content')}`}>{fact.value}</span>
            {fact.note === undefined ? null : <span className="block text-muted">{fact.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
