import { Check, CircleHelp, CircleX, LoaderCircle } from 'lucide-react';
import { Tooltip } from '../deps.js';
import type { ToolCall } from './grouping.js';
import { LOG_ICON } from './sizes.js';

/** The icon of a tool call status, with the words as tooltip and accessible name. */
export function ToolStatusIcon({ call }: { call: ToolCall }) {
  const look = {
    running: { Icon: LoaderCircle, text: 'text-hue-yellow animate-spin motion-reduce:animate-none', label: 'Running' },
    ok: { Icon: Check, text: 'text-hue-green', label: 'Finished' },
    error: { Icon: CircleX, text: 'text-hue-red', label: call.denialKind === undefined ? 'Failed' : `Failed (${call.denialKind})` },
    unknown: { Icon: CircleHelp, text: 'text-muted', label: 'No result was seen for this call' },
  }[call.status];
  return (
    <Tooltip content={look.label}>
      <span role="img" aria-label={look.label} className="inline-flex">
        <look.Icon aria-hidden="true" className={`${LOG_ICON} ${look.text}`} />
      </span>
    </Tooltip>
  );
}
