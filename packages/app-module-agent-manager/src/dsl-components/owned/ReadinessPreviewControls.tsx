import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReadinessPreview } from '../logic/readinessPreview.js';
import type { ReadinessPreviewValue } from '../logic/uiVariants.js';
import { Chip } from '../ui/Chip.js';
import { Scope } from '../ui/Scope.js';
import { useUiVariant } from '../ui/UiVariants.js';
import { MoveBanner } from './MoveBanner.js';
import { SwitchAction } from './SwitchAction.js';

const NOTHING = (): void => undefined;

/**
 * Dev dock only ("Preview Move readiness"): says in the header line that the readiness shown is a preview, and for an agent that cannot move by itself (a discovered or
 * ended one) draws the preview Move button of the chosen look in the header line (and the banner of look C under it). The button sends nothing: a click only says so.
 */
export function ReadinessPreviewControls({ preview, state, slot }: { preview: ReadinessPreview; state: Exclude<ReadinessPreviewValue, 'real'>; slot: HTMLElement | null }) {
  const readinessStyle = useUiVariant('switchReadiness');
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
      {preview.synthetic && readinessStyle === 'banner' ? <MoveBanner session={preview.session} /> : null}
      {note === '' ? null : (
        <p role="status" data-readiness-preview-note="" className="text-sm text-muted">
          {note}
        </p>
      )}
    </>
  );
}
