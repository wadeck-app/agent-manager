import { Info } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '@wadeck-app/dsl-ui';
import { AnchoredPopup } from './AnchoredPopup.js';

/** The Details button of the C look: the detail of the header in a floating panel anchored to the button (outside the flow of the header, so the header keeps its height). */
export function DetailsButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchor} className="inline-flex shrink-0">
      <IconButton
        variant={open ? 'neutral' : 'ghost'}
        icon={<Info aria-hidden="true" className="h-4 w-4" />}
        aria-label={open ? 'Hide details' : 'Show details'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      />
      {open ? (
        <AnchoredPopup anchor={anchor} id={panelId} role="dialog" label="Details" focusOnOpen="button, [tabindex]" width={560} onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-1 p-2">{children}</div>
        </AnchoredPopup>
      ) : null}
    </span>
  );
}
