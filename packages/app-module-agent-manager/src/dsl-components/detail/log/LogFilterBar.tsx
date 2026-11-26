import { ButtonAction } from '@wadeck-app/dsl-ui';
import { Banner } from '../deps.js';
import { FilterToggles } from './FilterToggles.js';
import type { Filtered, LogFiltersFeed } from './logFilters.js';

/**
 * The filters at the top of the log: three toggles with the number of entries of each family among the LOADED entries (older ones load on scroll), and the total
 * hidden next to them, so nothing is hidden silently. A choice is remembered by the browser. The bar itself is an option (hidden by default, the filter button of
 * the header holds the same switches); the sentence about choices that could not be read or saved shows either way.
 */
export function LogFilterBar({ feed, filtered }: { feed: LogFiltersFeed; filtered: Filtered }) {
  return (
    <div className="flex flex-col">
      {feed.showBar ? <FilterToggles feed={feed} filtered={filtered} /> : null}
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
