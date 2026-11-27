import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import { DEFAULT_ROW_LOOK, rowLookVars, type RowLook } from '../logic/rowLook.js';

interface RowLookControl {
  look: RowLook;
  setLook: (next: RowLook) => void;
}

// Without a provider (a test, a component used alone) the look is the default and changing it fails loudly: a menu that edits nothing must not look as if it worked.
const NO_PROVIDER: RowLookControl = {
  look: DEFAULT_ROW_LOOK,
  setLook: () => {
    throw new Error('The row look cannot be changed here: no RowLookProvider above this menu (the Workspace page provides one).');
  },
};

const RowLookContext = createContext<RowLookControl>(NO_PROVIDER);

/** The look of the state of the rows (logic/rowLook.ts) for every list below. */
export function useRowLook(): RowLook {
  return useContext(RowLookContext).look;
}

/** The look and its setter, for the menu that edits it. */
export function useRowLookControl(): RowLookControl {
  return useContext(RowLookContext);
}

/**
 * Provides the look and puts its CSS variables on a wrapper without a box (`contents`: custom properties inherit through it), so the classes of the rows
 * (`bg-[color:var(--am-herdr-needs-bg)]`...) read the colors the user chose.
 */
export function RowLookProvider({ look, setLook, children }: { look: RowLook; setLook: (next: RowLook) => void; children: ReactNode }) {
  const value = useMemo(() => ({ look, setLook }), [look, setLook]);
  const style = useMemo(() => rowLookVars(look) as CSSProperties, [look]);
  return (
    <RowLookContext.Provider value={value}>
      <div className="contents" data-row-look="" style={style}>
        {children}
      </div>
    </RowLookContext.Provider>
  );
}
