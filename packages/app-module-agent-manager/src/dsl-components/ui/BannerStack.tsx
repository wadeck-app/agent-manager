import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { SetterContext, ViewContext, type StackedItem, type StackView } from './bannerStackKit.js';

/**
 * ONE banner for every message that sits between the log and the reply box, whatever their number: the worst tone, the title of the first message (never cut by an
 * ellipsis), "and N more" when there are several, and a disclosure that opens every message whole with its action. It takes a line or two instead of one banner
 * per message, so the log keeps the height. The messages come from `StackedBanner` components anywhere below the provider.
 */
export function BannerStackProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Record<string, StackedItem>>({});
  const runs = useRef(new Map<string, () => void>());
  const [open, setOpen] = useState(false);
  const set = useCallback((id: string, item: StackedItem | undefined, run: () => void) => {
    runs.current.set(id, run);
    setItems((before) => {
      const same = before[id];
      if (item === undefined) {
        if (same === undefined) {
          return before;
        }
        const { [id]: _gone, ...rest } = before;
        return rest;
      }
      if (same !== undefined && same.tone === item.tone && same.text === item.text && same.actionLabel === item.actionLabel) {
        return before;
      }
      return { ...before, [id]: item };
    });
  }, []);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  const run = useCallback((id: string) => runs.current.get(id)?.(), []);
  const view = useMemo<StackView>(() => ({ items, open, toggle, run }), [items, open, toggle, run]);
  return (
    <SetterContext.Provider value={set}>
      <ViewContext.Provider value={view}>{children}</ViewContext.Provider>
    </SetterContext.Provider>
  );
}
