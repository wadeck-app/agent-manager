import { CompactSelect } from '@wadeck-app/dsl-ui';
import { FOCUS_RING } from '../ui/focusRing.js';

/** Why a background session has no Interrupt: claude has no stop-turn command (checked in `claude --help` and the documented commands), only the terminal. */
export const BG_NO_INTERRUPT = 'A background session has no remote interrupt: claude has no stop-turn command, attach and press Esc in the terminal.';
export const BG_NO_MODE = 'The permission mode of a background session cannot be changed remotely.';

/** What a background session cannot do from this page, and why: the disclosure of the wide layout, and the list inside the details of the compact row. */
export function BgLimits({ permissionMode, asList = false }: { permissionMode: string | undefined; asList?: boolean }) {
  const list = (
    <ul className="mt-1 list-none">
      <li id="bg-no-interrupt">{BG_NO_INTERRUPT}</li>
      <li id="bg-no-mode" data-bg-no-mode="">
        <label className="inline-flex items-center gap-1.5">
          Mode
          <CompactSelect ariaLabel="Permission mode" disabled value={permissionMode ?? ''} onChange={() => undefined} options={[{ value: permissionMode ?? '', label: permissionMode ?? '(set at launch)' }]} />
        </label>{' '}
        {BG_NO_MODE}
      </li>
    </ul>
  );
  if (asList) {
    return <div data-bg-limits-list="">{list}</div>;
  }
  return (
    <details data-bg-limits="" className="text-xs text-muted">
      <summary className={`cursor-pointer rounded ${FOCUS_RING}`}>Why are Interrupt and Permission mode not available?</summary>
      {list}
    </details>
  );
}
