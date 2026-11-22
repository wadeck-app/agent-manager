import { Checkbox } from '@wadeck-app/dsl-ui';
import { useEffect, useRef } from 'react';
import { useSelection } from '../lists/selection.js';
import { groupCheck } from '../logic/selection.js';

/** The select-all box of the toolbar: ticks every session the current list shows (a folded group included), indeterminate when only some are ticked. */
export function SelectAllBox({ ids }: { ids: readonly string[] }) {
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
  return <Checkbox ref={ref} aria-label={`Select all ${ids.length} listed sessions`} title="Select all the listed sessions" checked={state === 'all'} onChange={() => selection.setMany(ids, state !== 'all')} />;
}

