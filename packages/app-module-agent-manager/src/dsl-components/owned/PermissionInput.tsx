import { ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { FOCUS_RING } from '../ui/focusRing.js';
import { isLarge } from './permissionBlocks.js';

/**
 * One block of the tool input, as text. A block of more than 3 lines (or one very long line) shows 3 lines, with a visible button that says how much is hidden
 * (the whole text stays in the page; open, it scrolls inside a box of at most 40% of the screen height).
 */
export function PermissionInput({ label, text }: { label: string; text: string }) {
  const large = isLarge(text);
  const [open, setOpen] = useState(!large);
  const lines = text.split('\n').length;
  return (
    <div data-permission-input="">
      <p className="mb-0.5 text-xs text-muted-tint">{label}</p>
      <pre className={`whitespace-pre-wrap break-words rounded border border-border bg-surface px-2 py-1 font-mono text-am-mono text-content ${open ? 'max-h-[40vh] overflow-auto' : 'line-clamp-3 overflow-hidden'}`}>{text}</pre>
      {large ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`mt-0.5 inline-flex items-center gap-1 rounded px-1 text-xs text-primary hover:underline ${FOCUS_RING}`}>
          <ChevronsUpDown aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          {open ? 'Fold it' : `Show all (${lines} lines, ${text.length} characters)`}
        </button>
      ) : null}
    </div>
  );
}
