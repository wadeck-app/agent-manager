import { useRef, type ReactNode } from 'react';
import { useTrailWidth } from './useTrailWidth.js';

/** The toolbar row inside the shell trail slot: capped to the room the trail row leaves it (useTrailWidth), so it wraps instead of pushing the page sideways. */
export function TrailRow({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useTrailWidth(ref);
  return (
    <div ref={ref} data-toolbar="" data-placement="in-trail" className={className}>
      {children}
    </div>
  );
}
