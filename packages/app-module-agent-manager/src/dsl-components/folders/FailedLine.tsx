import { RotateCw } from 'lucide-react';
import { Banner } from '../ui/Banner.js';
import { FOCUS_RING } from '../ui/IconButton.js';

/** A failure with what to do, and a retry when asking again can help. */
export function FailedLine({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="p-1">
      <Banner
        tone="error"
        action={
          onRetry === undefined ? undefined : (
            <button type="button" onClick={onRetry} className={`inline-flex shrink-0 items-center gap-1 rounded border border-danger px-2 py-0.5 text-xs ${FOCUS_RING}`}>
              <RotateCw aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
              Retry
            </button>
          )
        }
      >
        {text}
      </Banner>
    </div>
  );
}
