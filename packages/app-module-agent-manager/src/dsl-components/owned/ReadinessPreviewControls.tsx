import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReadinessPreview } from '../logic/readinessPreview.js';
import type { ReadinessPreviewValue } from '../logic/uiVariants.js';
import { Chip } from '../ui/Chip.js';
import { Scope } from '../ui/Scope.js';
import { SwitchAction } from './SwitchAction.js';

const NOTHING = (): void => undefined;

/**
 * Dev dock only ("Preview hand-over"): says in the header line that the readiness shown is a preview, and for an agent that cannot be handed over by itself (a discovered or
 * ended one) draws the preview hand-over button of the chosen look in the header line. The button sends nothing: a click only says so.
 */
export function ReadinessPreviewControls({ preview, state, slot }: { preview: ReadinessPreview; state: Exclude<ReadinessPreviewValue, 'real'>; slot: HTMLElement | null }) {
  const [note, setNote] = useState('');
  return (
    <>
      {slot === null
        ? null
        : createPortal(
            <Scope>
              <Chip data-readiness-preview={state} variant="info" icon={<FlaskConical aria-hidden="true" className="h-3 w-3" />}>
                {`Preview: ${state}`}
              </Chip>
              {preview.synthetic ? <SwitchAction session={preview.session} disabled={false} onChange={NOTHING} onNote={setNote} onError={setNote} compact previewOnly /> : null}
            </Scope>,
            slot,
          )}
      {note === '' ? null : (
        <p role="status" data-readiness-preview-note="" className="text-sm text-muted">
          {note}
        </p>
      )}
    </>
  );
}
