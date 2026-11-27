import { TabButton, Tooltip } from '@wadeck-app/dsl-ui';
import { hiddenSentence, NAME } from './filterNames.js';
import { LOG_CATEGORIES, type Filtered, type LogFiltersFeed } from './logFilters.js';
import { LOG_META } from './sizes.js';

const FILTER_BAR = 'flex flex-nowrap items-center gap-1 overflow-x-auto border-b border-border px-3 py-1 [&>*]:shrink-0';

/** The row of toggles of the bar: one per family with its count among the loaded entries, and the total hidden at the right. */
export function FilterToggles({ feed, filtered }: { feed: LogFiltersFeed; filtered: Filtered }) {
  return (
    <div role="group" aria-label="Show in the log" className={FILTER_BAR}>
      {LOG_CATEGORIES.map((category) => {
        const on = feed.prefs[category];
        const count = filtered.counts[category];
        return (
          <Tooltip key={category} content={`${on ? 'Hide' : 'Show'} ${NAME[category].plural}: ${count} in the loaded entries`}>
            <TabButton
              size="sm"
              // A filled button when shown (the muted fill of the base neutral button, with the underline of an active tab), a plain one when hidden: a 1 px border alone is too faint to read a switch by (QA finding Q32).
              variant={on ? 'neutral' : 'ghost'}
              active={on}
              aria-pressed={on}
              data-filter={category}
              onClick={() => feed.change({ [category]: !on })}
            >
              {NAME[category].label} <span className="tabular-nums text-muted">{count}</span>
            </TabButton>
          </Tooltip>
        );
      })}
      {filtered.hiddenTotal > 0 ? (
        <Tooltip content={`Hidden by the filters: ${hiddenSentence(filtered.hidden)}`}>
          <span data-hidden-marker="" className={`ml-auto tabular-nums ${LOG_META} text-muted`}>
            {filtered.hiddenTotal} hidden
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
