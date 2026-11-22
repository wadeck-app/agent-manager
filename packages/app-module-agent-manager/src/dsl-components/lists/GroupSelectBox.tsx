import { Checkbox } from '@wadeck-app/dsl-ui';
import { useEffect, useRef } from 'react';
import { groupCheck } from '../logic/selection.js';
import { useSelection } from './selection.js';

/** The select-all box of a group header (a folder, a custom group): checked when every member is selected, indeterminate when some are. */
export function GroupSelectBox({ ids, name }: { ids: readonly string[]; name: string }) {
  const selection = useSelection();
  const ref = useRef<HTMLInputElement>(null);
  const state = selection === null ? 'none' : groupCheck(ids, selection.selected);
  useEffect(() => {
    if (ref.current !== null) {
      ref.current.indeterminate = state === 'some';
    }
  }, [state]);
  if (selection === null || ids.length === 0) {
    return null;
  }
  const shown = selection.count > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100';
  return (
    <span data-group-checkbox="" className={`inline-flex ${state === 'none' ? shown : 'opacity-100'}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <Checkbox ref={ref} tabIndex={-1} aria-label={`Select all ${ids.length === 1 ? "1 session" : `${ids.length} sessions`} of ${name}`} checked={state === 'all'} onChange={() => selection.setMany(ids, state !== 'all')} />
    </span>
  );
}
