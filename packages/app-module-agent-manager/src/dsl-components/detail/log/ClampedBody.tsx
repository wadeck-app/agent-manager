import { ButtonAction } from '@wadeck-app/dsl-ui';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const FADE = '[mask-image:linear-gradient(to_bottom,black_70%,transparent)]';

/**
 * A long message cut at `lines` lines with Show more (the layouts that clamp, see chatLayouts.ts). No `lines`: the children as they are, nothing added.
 * The cut is a max height in line heights (the body is blocks, which line-clamp does not cut), and the button only exists when the text overflows.
 */
export function ClampedBody({ lines, children }: { lines: number | undefined; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (lines === undefined || element === null || open) {
      return undefined;
    }
    const measure = (): void => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [lines, open]);
  if (lines === undefined) {
    return <>{children}</>;
  }
  const cut = overflows && !open;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <div ref={box} data-clamped={cut ? 'true' : undefined} style={open ? undefined : { maxHeight: `${lines}lh` }} className={`w-full min-w-0 overflow-hidden text-sm leading-am-log ${cut ? FADE : ''}`}>
        {children}
      </div>
      {overflows ? <ButtonAction variant="link" size="xs" label={open ? 'Show less' : 'Show more'} ariaLabel={open ? 'Show less of this message' : 'Show more of this message'} onClick={() => setOpen(!open)} /> : null}
    </div>
  );
}
