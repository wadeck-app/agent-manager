import { Fragment, type ReactNode } from 'react';
import { Scope } from './Scope.js';

export interface TipRow {
  label: string;
  value: ReactNode;
  /** Keeps at most 4 lines of the value, then an ellipsis (a long command): no empty band is left under the last line. */
  clamp?: boolean;
}

// Classes are static strings (Tailwind finds them by scanning the sources).
// The label column fits its widest label and never wraps. The value column is `minmax(0, 1fr)`: a plain `1fr` has a minimum of its content, so a long word with no
// space (a path, a command) would push the column out of the card.
const GRID = 'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-left';
const LABEL = 'whitespace-nowrap text-white/70';
// Left aligned, and a word with no break opportunity breaks anywhere (`anywhere` lowers the minimum width of the column, `break-word` does not).
const VALUE = 'min-w-0 text-left text-white [overflow-wrap:anywhere]';
const CLAMP = 'line-clamp-4';
const NOTE = 'text-left [overflow-wrap:anywhere]';
const NOTE_GAP = 'mt-1.5';

/**
 * The body of a dsl-ui Tooltip with labelled details, passed as its `content` (the `rows` prop of the Tooltip is not used: its grid column grows with the longest
 * unbreakable word and its values are right aligned, see .claude/session/dsl-owner-tooltip-report.md). The card is portaled out of our scope and has a fixed dark
 * surface in both themes: the Scope puts our utilities back, and the text uses the white tints of the card (never the semantic colours of the page, unreadable on it).
 * The card is as wide as its widest line up to the max width of the Tooltip, so a short value gives a narrow card.
 */
export function TipRows({ rows, note }: { rows: readonly TipRow[]; note?: ReactNode }) {
  return (
    <Scope>
      {rows.length === 0 ? null : (
        <dl data-tip-rows="" className={GRID}>
          {rows.map((row, index) => (
            <Fragment key={`${row.label}:${index}`}>
              <dt className={LABEL}>{row.label}</dt>
              <dd className={`${VALUE} ${row.clamp === true ? CLAMP : ''}`}>{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {note === undefined || note === '' ? null : <div className={`${NOTE} ${rows.length === 0 ? '' : NOTE_GAP}`}>{note}</div>}
    </Scope>
  );
}
