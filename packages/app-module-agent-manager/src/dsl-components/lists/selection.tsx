import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pruneSelection, rangeBetween } from '../logic/selection.js';

/** What a row, a group header and the toolbar need to select sessions. All ids are agentId (the lowercase session id). */
export interface SelectionApi {
  selected: ReadonlySet<string>;
  count: number;
  /** Selection mode: the checkboxes of the rows and of the group headers are shown. Off by default; every way of selecting (a checkbox, shift or ctrl click, X, select all) turns it on. */
  mode: boolean;
  /** Turns the mode on, or off (off also clears the selection: leaving the mode never leaves a hidden selection that a batch could act on). */
  setMode: (on: boolean) => void;
  isSelected: (id: string) => boolean;
  /** Ctrl or Cmd click, or the checkbox of a row: adds or removes one id and makes it the anchor of the next range. */
  toggle: (id: string) => void;
  /** Shift click: adds every id from the anchor to `id` among `visible` (the ids on screen, in order). Without an anchor it selects `id` alone. */
  selectRange: (id: string, visible: readonly string[]) => void;
  /** The select-all box of a group, the toolbar: adds or removes these ids. */
  setMany: (ids: readonly string[], on: boolean) => void;
  /** Clears the selection and leaves the selection mode. */
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
  const [mode, setModeState] = useState(false);
  const anchor = useRef<string | undefined>(undefined);

  useEffect(() => {
    setSelected((current) => pruneSelection(current, existing));
    if (anchor.current !== undefined && !existing.has(anchor.current)) {
      anchor.current = undefined;
    }
  }, [existing]);

  const toggle = useCallback((id: string) => {
    anchor.current = id;
    setModeState(true);
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
    setModeState(true);
    setSelected((current) => new Set([...current, ...ids]));
  }, []);
  const setMany = useCallback((ids: readonly string[], on: boolean) => {
    setModeState(true);
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
    setModeState(false);
    setSelected(NONE);
  }, []);
  const setMode = useCallback(
    (on: boolean) => {
      if (on) {
        setModeState(true);
      } else {
        clear();
      }
    },
    [clear],
  );

  const api = useMemo<SelectionApi>(() => ({ selected, count: selected.size, mode, setMode, isSelected: (id) => selected.has(id), toggle, selectRange, setMany, clear }), [selected, mode, setMode, toggle, selectRange, setMany, clear]);
  return <SelectionContext.Provider value={api}>{children}</SelectionContext.Provider>;
}
