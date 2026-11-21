import { getErrorMessage } from '../logic/errorText.js';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { FOCUS_RING } from '../ui/IconButton.js';

export interface BgAttachProps {
  /** `claude attach <id>`, as the daemon gives it. Undefined while the daemon record is not read yet: the panel then says so. */
  command: string | undefined;
  /** What the session waits on (`permission prompt`, ...), when it waits. */
  waitingFor: string | undefined;
}

/**
 * The way into a background session that needs a terminal: the exact command, a Copy button, and (when the session waits) what it waits on. A permission prompt of a
 * background session cannot be answered from this page (documented: only `claude attach`), so this panel is the answer to "what do I do now". A clipboard that is
 * not available is said, never ignored.
 */
export function BgAttach({ command, waitingFor }: BgAttachProps) {
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState('');
  const copy = async (): Promise<void> => {
    if (command === undefined) {
      return;
    }
    setCopied(false);
    setFailure('');
    try {
      if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
        throw new Error('the clipboard is not available in this browser or page (it needs a secure context)');
      }
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch (error) {
      setFailure(`The command could not be copied (${getErrorMessage(error)}). Select it and copy it by hand: ${command}`);
    }
  };
  return (
    <div data-bg-attach="" className={`flex flex-col gap-1 rounded border px-3 py-2 text-sm ${waitingFor === undefined ? 'border-border' : 'border-warning bg-warning-bg text-warning-text'}`}>
      <p className="font-medium">{waitingFor === undefined ? 'Open it in a terminal' : `Answer in a terminal: this session waits on a ${waitingFor}`}</p>
      {waitingFor === undefined ? null : <p className="text-xs">A background session cannot be answered from this page: attach to it, answer there, then detach.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {command === undefined ? (
          <span className="text-xs text-muted">The attach command is not known yet: the daemon record is still being read.</span>
        ) : (
          <>
            <code data-bg-attach-command="" className="rounded bg-muted-bg px-2 py-1 font-mono text-am-mono text-content">
              {command}
            </code>
            <button type="button" onClick={() => void copy()} className={`inline-flex h-am-hit items-center gap-1.5 rounded border border-border bg-surface px-3 text-sm text-content hover:bg-muted-bg ${FOCUS_RING}`}>
              {copied ? <Check aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" /> : <Copy aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />}
              {copied ? 'Copied' : 'Copy command'}
            </button>
          </>
        )}
      </div>
      {failure !== '' ? (
        <p role="alert" className="text-xs text-danger-text">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
