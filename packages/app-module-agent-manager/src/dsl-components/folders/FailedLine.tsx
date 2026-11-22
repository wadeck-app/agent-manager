import { ButtonAction } from '@wadeck-app/dsl-ui';
import { RotateCw } from 'lucide-react';
import { Banner } from '../ui/Banner.js';

/** A failure with what to do, and a retry when asking again can help. */
export function FailedLine({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="p-1">
      <Banner
        tone="error"
        action={
          onRetry === undefined ? undefined : (
<ButtonAction variant="secondary" size="sm" icon={<RotateCw aria-hidden="true" className="h-3.5 w-3.5" />} label="Retry" onClick={onRetry} />
          )
        }
      >
        {text}
      </Banner>
    </div>
  );
}
