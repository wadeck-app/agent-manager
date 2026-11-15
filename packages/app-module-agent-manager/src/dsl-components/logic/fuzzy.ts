import type { AgentState, SessionRowDto } from './states.js';
import { GROUP_ORDER } from './states.js';

/** The states a `state:` filter accepts, in display order. */
export const FILTERABLE_STATES: readonly AgentState[] = GROUP_ORDER.filter((id): id is AgentState => id !== 'pinned');

export interface QueryFilter {
  /** `!project:shop`: keep the sessions that do NOT match. */
  negate: boolean;
  value: string;
}

export interface ParsedQuery {
  /** Free words: each must match (fuzzily) the name, the folder, the path or the last activity. */
  terms: string[];
  states: { negate: boolean; state: AgentState }[];
  projects: QueryFilter[];
  /** What the user typed that cannot be applied (unknown state, empty value): shown next to the input, never ignored silently. */
  problems: string[];
}

/** The state a typed value means: an exact name, or a prefix that fits exactly one state ("nee" is needs-you, "i" is idle, "e" is ended). */
export function resolveState(text: string): AgentState | undefined {
  const value = text.toLowerCase();
  if (value === '') {
    return undefined;
  }
  const exact = FILTERABLE_STATES.find((state) => state === value);
  if (exact !== undefined) {
    return exact;
  }
  const candidates = FILTERABLE_STATES.filter((state) => state.startsWith(value));
  return candidates.length === 1 ? candidates[0] : undefined;
}

const STATE_HELP = 'needs-you, done, working, idle, other, ended';

/**
 * The query language of the palette (the filter prefixes of the herdr goto picker and the k9s `!` inverse are the inspiration, the exact grammar is our own):
 * `state:done`, `project:shop`, `!state:idle` and free words. A value that is no state is a problem the UI shows, not a silent "everything".
 */
export function parseQuery(text: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], states: [], projects: [], problems: [] };
  for (const token of text.split(/\s+/).filter((part) => part !== '')) {
    const negate = token.startsWith('!');
    const body = negate ? token.slice(1) : token;
    const colon = body.indexOf(':');
    const key = colon === -1 ? '' : body.slice(0, colon).toLowerCase();
    const value = colon === -1 ? '' : body.slice(colon + 1);
    if (key === 'state') {
      const state = resolveState(value);
      if (state === undefined) {
        parsed.problems.push(value === '' ? `state: needs a value (${STATE_HELP})` : `'${value}' is not a state (${STATE_HELP})`);
      } else {
        parsed.states.push({ negate, state });
      }
    } else if (key === 'project') {
      if (value === '') {
        parsed.problems.push('project: needs a folder name');
      } else {
        parsed.projects.push({ negate, value });
      }
    } else {
      parsed.terms.push(token);
    }
  }
  return parsed;
}

const WORD_START = /[\s/\\\-_.]/;

/**
 * Subsequence match of `needle` in `haystack`, case-insensitive. Higher is better, undefined when the letters do not appear in order.
 * Bonuses: a run of consecutive letters, a letter at the start of a word (after space, slash, backslash, dash, underscore, dot) or of the text.
 */
export function fuzzyScore(needle: string, haystack: string): number | undefined {
  const query = needle.toLowerCase();
  const text = haystack.toLowerCase();
  if (query === '') {
    return 0;
  }
  let score = 0;
  let position = 0;
  let previous = -2;
  for (const letter of query) {
    const found = text.indexOf(letter, position);
    if (found === -1) {
      return undefined;
    }
    score += 1;
    if (found === previous + 1) {
      score += 3;
    }
    if (found === 0 || WORD_START.test(text.charAt(found - 1))) {
      score += 2;
    }
    previous = found;
    position = found + 1;
  }
  // A short text that contains the letters is a closer match than a long path that merely does.
  return score - text.length / 1000;
}

function fieldsOf(session: SessionRowDto): string[] {
  return [session.displayName, session.folder, session.cwd, session.lastActivity];
}

/** The best score of a free word over the fields of a session. */
function termScore(term: string, session: SessionRowDto): number | undefined {
  let best: number | undefined;
  fieldsOf(session).forEach((field, index) => {
    const score = fuzzyScore(term, field);
    // The name and the folder weigh more than the path and the activity text.
    const weighted = score === undefined ? undefined : score + (index < 2 ? 4 : 0);
    if (weighted !== undefined && (best === undefined || weighted > best)) {
      best = weighted;
    }
  });
  return best;
}

/** The sessions that satisfy the query. Free words rank by score (best first); without any free word the input order is kept. */
export function filterSessions(sessions: readonly SessionRowDto[], query: ParsedQuery): SessionRowDto[] {
  const scored: { session: SessionRowDto; score: number; index: number }[] = [];
  sessions.forEach((session, index) => {
    for (const filter of query.states) {
      if ((session.state === filter.state) === filter.negate) {
        return;
      }
    }
    for (const filter of query.projects) {
      if ((fuzzyScore(filter.value, session.folder) !== undefined) === filter.negate) {
        return;
      }
    }
    let total = 0;
    for (const term of query.terms) {
      const score = termScore(term, session);
      if (score === undefined) {
        return;
      }
      total += score;
    }
    scored.push({ session, score: total, index });
  });
  if (query.terms.length > 0) {
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
  }
  return scored.map((entry) => entry.session);
}

/**
 * The indices of `haystack` that a fuzzy match of the words `terms` lights up (first-fit, like fuzzyScore: the letters of a word in order), for
 * highlighting. A word that does not match adds nothing; the result is sorted and without duplicates.
 */
export function matchPositions(terms: readonly string[], haystack: string): number[] {
  const text = haystack.toLowerCase();
  const found = new Set<number>();
  for (const term of terms) {
    const picked: number[] = [];
    let position = 0;
    for (const letter of term.toLowerCase()) {
      const at = text.indexOf(letter, position);
      if (at === -1) {
        picked.length = 0;
        break;
      }
      picked.push(at);
      position = at + 1;
    }
    picked.forEach((index) => found.add(index));
  }
  return [...found].sort((a, b) => a - b);
}
