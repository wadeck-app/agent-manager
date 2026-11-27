import { useState } from 'react';
import { ButtonAction } from '@wadeck-app/dsl-ui';
import { CopyButton } from './CopyButton.js';
import { capOutput, formatBytes } from './format.js';
import { LOG_META, LOG_MONO, OUTPUT_CAP_CHARS, OUTPUT_CAP_LINES } from './sizes.js';

export function ToolOutput({ text, truncatedByServer, bytes }: { text: string; truncatedByServer: boolean; bytes?: number }) {
  const [all, setAll] = useState(false);
  const capped = capOutput(text, OUTPUT_CAP_CHARS, OUTPUT_CAP_LINES);
  const shown = all || !capped.cut ? text : capped.text;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className={`${LOG_META} text-muted`}>Output{bytes === undefined ? '' : ` (${formatBytes(bytes)})`}</span>
        <CopyButton text={text} label="Copy output" />
      </div>
      <pre className={`max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted-bg p-2 ${LOG_MONO}`}>{shown}</pre>
      {capped.cut ? (
        <div className="self-start">
          <ButtonAction variant="link" size="xs" onClick={() => setAll(!all)} label={all ? 'Show less' : `Show more (${capped.hiddenChars} more characters)`} />
        </div>
      ) : null}
      {truncatedByServer ? (
        <p className={`${LOG_META} text-muted`}>
          Preview only{bytes === undefined ? '' : `: the full output is ${formatBytes(bytes)}`}. The log does not serve the rest.
        </p>
      ) : null}
    </div>
  );
}
