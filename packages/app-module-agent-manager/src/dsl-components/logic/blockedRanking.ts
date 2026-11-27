import type { GuardrailBlocksDto } from '../shared.js';
import { getErrorMessage } from './errorText.js';
import { RECENT_WINDOW_TEXT } from './guardrails.js';

/** How many categories the Blocked part of the Permissions tab lists; the others are on the Guardrails page. */
export const BLOCKED_TOP = 5;

/** `count`: the most blocked categories (all time). `recent`: the categories blocked in the last 30 min, the most blocked of them first. */
export const BLOCKED_RANKINGS = ['count', 'recent'] as const;
export type BlockedRanking = (typeof BLOCKED_RANKINGS)[number];

export const BLOCKED_RANKING_LABEL: Record<BlockedRanking, string> = { count: 'Most blocked', recent: `Last ${RECENT_WINDOW_TEXT}` };

export const BLOCKED_RANKING_KEY = 'agent-manager.blockedRanking';

export function isBlockedRanking(value: unknown): value is BlockedRanking {
  return BLOCKED_RANKINGS.some((ranking) => ranking === value);
}

/** The saved choice; nothing saved is the default (Most blocked). A stored value that is not a ranking, or a storage that throws, is a problem the caller says (never silent). */
export function readBlockedRanking(): { ranking: BlockedRanking; problem: string } {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(BLOCKED_RANKING_KEY);
  } catch (error) {
    return { ranking: 'count', problem: `Your choice of ranking could not be read (${getErrorMessage(error)}): Most blocked is shown.` };
  }
  if (raw === null) {
    return { ranking: 'count', problem: '' };
  }
  return isBlockedRanking(raw) ? { ranking: raw, problem: '' } : { ranking: 'count', problem: `The saved ranking "${raw}" is not one of ${BLOCKED_RANKINGS.join(', ')}: Most blocked is shown.` };
}

/** Saves the choice; a storage that refuses is returned as a sentence (the choice then holds until the page is reloaded). */
export function saveBlockedRanking(ranking: BlockedRanking): string {
  try {
    window.localStorage.setItem(BLOCKED_RANKING_KEY, ranking);
    return '';
  } catch (error) {
    return `Your choice of ranking could not be saved (${getErrorMessage(error)}): it holds until the page is reloaded.`;
  }
}

export interface RankedBlocks {
  /** The top BLOCKED_TOP categories, in the order of the ranking. */
  shown: { category: string; count: number }[];
  /** How many categories of the same list are not shown. */
  hidden: number;
  /** What the numbers of the rows count: "in total" (the plugin counters) or "in the last 30 min" (the journal). */
  scope: string;
}

/**
 * The categories of the Blocked part. Both rankings read ONE list whose numbers agree with the heading (blockedCountsText): the plugin counters (all time) when they hold at least as
 * many blocks as the journal of the last 30 min, else the journal (the counters are missing for the session, and a total of 0 next to rows would contradict the heading).
 */
export function rankBlocks(blocks: GuardrailBlocksDto, ranking: BlockedRanking): RankedBlocks {
  const countersMissing = blocks.total < blocks.recent.total;
  const useRecent = ranking === 'recent' || countersMissing;
  const list = useRecent ? blocks.recent.categories : blocks.categories;
  const ordered = [...list].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return { shown: ordered.slice(0, BLOCKED_TOP), hidden: Math.max(0, ordered.length - BLOCKED_TOP), scope: useRecent ? `in the last ${RECENT_WINDOW_TEXT}` : 'in total' };
}
