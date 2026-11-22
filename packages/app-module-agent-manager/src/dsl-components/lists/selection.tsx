import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pruneSelection, rangeBetween } from '../logic/selection.js';

/** What a row, a group header and the toolbar need to select sessions. All ids are agentId (the lowercase session id). */
export interface SelectionApi {
  selected: ReadonlySet<string>;
  count: number;
  isSelected: (id: string) => boolean;
  /** Ctrl or Cmd click, or the checkbox of a row: adds or removes one id and makes it the anchor of the next range. */
  toggle: (id: string) => void;
  /** Shift click: adds every id from the anchor to `id` among `visible` (the ids on screen, in order). Without an anchor it selects `id` alone. */
  selectRange: (id: string, visible: readonly string[]) => void;
  /** The select-all box of a group, the toolbar: adds or removes these ids. */
  setMany: (ids: readonly string[], on: boolean) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionApi | null>(null);

/** The selection of the page, or null outside a provider (a list drawn alone, as in most tests, has no checkboxes). */
export function useSelection(): SelectionApi | null {
  return useContext(SelectionContext);
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Owns the selected ids. `existing` is the ids of every session the page has: an id that is not in it any more is dropped (a session that ended or was
 * forgotten must not stay selected and be messaged by a later batch).
 */
export function SelectionProvider({ existing, children }: { existing: ReadonlySet<string>; children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(NONE);
  const anchor = useRef<string | undefined>(undefined);

  useEffect(() => {
    setSelected((current) => pruneSelection(current, existing));
    if (anchor.current !== undefined && !existing.has(anchor.current)) {
      anchor.current = undefined;
    }
  }, [existing]);

  const toggle = useCallback((id: string) => {
    anchor.current = id;
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }, []);
  const selectRange = useCallback((id: string, visible: readonly string[]) => {
    const ids = rangeBetween(visible, anchor.current, id);
    if (anchor.current === undefined) {
      anchor.current = id;
    }
    setSelected((current) => new Set([...current, ...ids]));
  }, []);
  const setMany = useCallback((ids: readonly string[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => {
    anchor.current = undefined;
    setSelected(NONE);
  }, []);

  const api = useMemo<SelectionApi>(() => ({ selected, count: selected.size, isSelected: (id) => selected.has(id), toggle, selectRange, setMany, clear }), [selected, toggle, selectRange, setMany, clear]);
  return <SelectionContext.Provider value={api}>{children}</SelectionContext.Provider>;
}
