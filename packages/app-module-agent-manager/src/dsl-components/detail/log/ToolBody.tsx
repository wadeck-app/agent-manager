import { ToolOutput } from './ToolOutput.js';
import { CopyButton } from './CopyButton.js';
import { formatDuration } from './format.js';
import type { ToolCall } from './grouping.js';
import { LOG_META, LOG_MONO } from './sizes.js';

/** "3.2 s" for a finished call, empty while running or when the transcript has no time. */
export function durationText(call: ToolCall): string {
  return call.durationMs === undefined ? '' : formatDuration(call.durationMs);
}

/** What a tool call shows when opened: the input and the output (a preview, the server keeps the first characters only). */
export function ToolBody({ call }: { call: ToolCall }) {
  const input = Object.keys(call.input).length === 0 ? '' : JSON.stringify(call.input, null, 2);
  return (
    <div className="flex flex-col gap-2">
      {call.orphan === true ? <p className={`${LOG_META} text-muted`}>The call itself is not in the loaded entries: only its result is shown.</p> : null}
      {input !== '' ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`${LOG_META} text-muted`}>Input{call.inputTruncated ? ' (shortened)' : ''}</span>
            <CopyButton text={input} label="Copy input" />
          </div>
          <pre className={`max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-muted-bg p-2 ${LOG_MONO}`}>{input}</pre>
        </div>
      ) : call.inputSummary !== '' ? (
        <p className={`${LOG_META} text-muted`}>Input too large to show; summary: {call.inputSummary}</p>
      ) : null}
      {call.status === 'running' ? (
        <p className={`${LOG_META} text-muted`}>Running, no result yet.</p>
      ) : call.resultPreview !== undefined && call.resultPreview !== '' ? (
        <ToolOutput text={call.resultPreview} truncatedByServer={call.resultPreviewTruncated === true} {...(call.resultBytes === undefined ? {} : { bytes: call.resultBytes })} />
      ) : (
        <p className={`${LOG_META} text-muted`}>{call.status === 'unknown' ? 'No result was seen for this call.' : 'No text output.'}</p>
      )}
      {call.resultImages !== undefined && call.resultImages.length > 0 ? <p className={`${LOG_META} text-muted`}>{call.resultImages.length} image(s) in the result, not shown.</p> : null}
    </div>
  );
}
