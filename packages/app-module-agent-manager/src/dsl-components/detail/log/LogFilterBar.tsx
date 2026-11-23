import { ButtonAction, TabButton } from '@wadeck-app/dsl-ui';
import { Banner } from '../deps.js';
import { LOG_CATEGORIES, type Filtered, type LogCategory, type LogFiltersFeed } from './logFilters.js';
import { LOG_META } from './sizes.js';

const NAME: Record<LogCategory, { label: string; plural: string }> = {
  hooks: { label: 'Hooks', plural: 'hooks' },
  tools: { label: 'Tools', plural: 'tool calls' },
  agents: { label: 'Agent messages', plural: 'agent messages' },
};

/** "2 hooks, 1 agent message" of what the filters hide, for the tooltip of the marker. */
export function hiddenSentence(hidden: Filtered['hidden']): string {
  return LOG_CATEGORIES.filter((category) => hidden[category] > 0)
    .map((category) => `${hidden[category]} ${NAME[category].plural}`)
    .join(', ');
}

/**
 * The filters at the top of the log: three toggles with the number of entries of each family among the LOADED entries (older ones load on scroll), and the total
 * hidden next to them, so nothing is hidden silently. A choice is remembered by the browser.
 */
export function LogFilterBar({ feed, filtered }: { feed: LogFiltersFeed; filtered: Filtered }) {
  return (
    <div className="flex flex-col">
      <div role="group" aria-label="Show in the log" className="flex flex-nowrap items-center gap-1 overflow-x-auto border-b border-border px-3 py-1 [&>*]:shrink-0">
        {LOG_CATEGORIES.map((category) => {
          const on = feed.prefs[category];
          const count = filtered.counts[category];
          return (
            <TabButton
              key={category}
              size="sm"
              // A filled button when shown, a plain one when hidden: the underline of an active tab alone is too faint to read a switch by.
              variant={on ? 'secondary' : 'ghost'}
              active={on}
              aria-pressed={on}
              data-filter={category}
              title={`${on ? 'Hide' : 'Show'} ${NAME[category].plural}: ${count} in the loaded entries`}
              onClick={() => feed.change({ [category]: !on })}
            >
              {NAME[category].label} <span className="tabular-nums text-muted">{count}</span>
            </TabButton>
          );
        })}
        {filtered.hiddenTotal > 0 ? (
          <span data-hidden-marker="" className={`ml-auto tabular-nums ${LOG_META} text-muted`} title={`Hidden by the filters: ${hiddenSentence(filtered.hidden)}`}>
            {filtered.hiddenTotal} hidden
          </span>
        ) : null}
      </div>
      {feed.problem !== '' ? (
        <div className="px-3 pt-2">
          <Banner tone="warning" action={<ButtonAction variant="secondary" size="sm" label="Dismiss" onClick={feed.dismissProblem} />}>
            {feed.problem}
          </Banner>
        </div>
      ) : null}
    </div>
  );
}
