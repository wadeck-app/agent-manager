import { CompactSelect } from '@wadeck-app/dsl-ui';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { blockedCountsText, BLOCKED_RANKINGS, BLOCKED_RANKING_LABEL, bypassCommand, isBlockedRanking, PAGE_BASE, PageLink, rankBlocks, readBlockedRanking, RECENT_WINDOW_TEXT, saveBlockedRanking, type AgentRow, type BlockedRanking } from '../deps.js';
import { CopyButton } from '../log/CopyButton.js';
import { SECTION } from './sectionSpacing.js';
import type { SessionGrantsFeed } from './useSessionGrants.js';

const NOTE = 'text-xs text-muted';

const NO_BREAK_SPACE = String.fromCharCode(160);

/** "30 min" never breaks between the number and the unit (a no-break space): "min" alone on a second line says nothing. */
function keepMinutesTogether(text: string): string {
  return text.replaceAll(RECENT_WINDOW_TEXT, RECENT_WINDOW_TEXT.replaceAll(' ', NO_BREAK_SPACE));
}

/**
 * The Blocked part of the Permissions tab: the heading with its two counts (in total, in the last 30 min), the TOP 5 categories that blocked the session (the user picks the
 * ranking: the most blocked, or the ones blocked in the last 30 min; the choice is kept in this browser), a copy button per category, and a sentence with the number of the
 * others (they are on the Guardrails page, not drawn here).
 */
export function BlockedSection({ session, view }: { session: AgentRow; view: SessionGrantsFeed['view'] }) {
  const blocks = session.guardrailBlocks;
  const [saved] = useState(readBlockedRanking);
  const [ranking, setRanking] = useState<BlockedRanking>(saved.ranking);
  const [problem, setProblem] = useState(saved.problem);
  const pick = (value: string): void => {
    if (isBlockedRanking(value)) {
      setRanking(value);
      setProblem(saveBlockedRanking(value));
    }
  };
  const ranked = blocks === undefined ? undefined : rankBlocks(blocks, ranking);
  return (
    <section aria-label="Blocked" className={`${SECTION} px-3`}>
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-content">
        <ShieldAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm text-muted" />
        Blocked
        <span className="tabular-nums text-muted">{keepMinutesTogether(blockedCountsText(blocks))}</span>
      </h4>
      {blocks === undefined || ranked === undefined ? (
        <p className={`mt-1 ${NOTE}`}>No guardrail blocked this session (the plugin has no counter for it).</p>
      ) : (
        <>
          <div className="mt-1 flex items-center gap-1.5">
            <span className={NOTE}>Top 5 by</span>
            <CompactSelect size="sm" ariaLabel="Rank the blocked categories" tooltip="Which categories the list shows first: the most blocked, or the ones blocked in the last 30 min" value={ranking} onChange={pick} options={BLOCKED_RANKINGS.map((value) => ({ value, label: BLOCKED_RANKING_LABEL[value] }))} />
          </div>
          {problem === '' ? null : (
            <p role="alert" className="mt-1 text-xs text-warning-text">
              {problem}
            </p>
          )}
          {ranked.shown.length === 0 ? (
            <p className={`mt-1 ${NOTE}`}>{`No category was blocked ${ranked.scope}.`}</p>
          ) : (
            <ul aria-label={`Blocked by category, ${ranked.scope}`} className="mt-1 flex flex-col gap-0.5">
              {ranked.shown.map((item) => (
                <li key={item.category} className="flex items-center gap-1 text-xs">
                  <span className="min-w-0 flex-1 truncate text-content">{item.category}</span>
                  <span className="tabular-nums text-muted" aria-label={`${item.count} ${ranked.scope}`}>
                    {item.count}
                  </span>
                  <CopyButton text={bypassCommand(item.category)} label={`Copy ${bypassCommand(item.category)}: run it in this session yourself, the module grants nothing`} />
                </li>
              ))}
            </ul>
          )}
          {ranked.hidden === 0 ? null : (
            <p data-blocked-more="" className={`mt-1 flex flex-wrap items-center gap-x-1 ${NOTE}`}>
              {`${ranked.hidden} more categor${ranked.hidden === 1 ? 'y' : 'ies'} on the `}
              <PageLink to={`${PAGE_BASE}/guardrails`} label="Guardrails page" />
            </p>
          )}
        </>
      )}
      {view?.session !== undefined && view.session.refusedCount > 0 ? <p className={`mt-1 ${NOTE}`}>{`${view.session.refusedCount} bypass request${view.session.refusedCount === 1 ? ' was' : 's were'} refused or ignored.`}</p> : null}
      {blocks?.timeout === true ? <p className="mt-1 text-xs text-warning-text">Bypass requests are timed out for this session.</p> : null}
    </section>
  );
}
