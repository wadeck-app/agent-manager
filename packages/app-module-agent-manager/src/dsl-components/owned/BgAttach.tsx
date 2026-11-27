import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { useState } from 'react';
import { getErrorMessage } from '../logic/errorText.js';
import { BgLimits } from './BgLimits.js';

const ATTACH_COMMAND = 'min-w-0 flex-1 truncate rounded bg-muted-bg px-1.5 py-0.5 font-mono text-am-mono text-content';

export interface BgAttachProps {
  /** `claude attach <id>`, as the daemon gives it. Undefined while the daemon record is not read yet: the panel then says so. */
  command: string | undefined;
  /** What the session waits on (`permission prompt`, ...), when it waits. */
  waitingFor: string | undefined;
  /** The permission mode the session was launched with (read only here), for the explanation of what is not available. */
  permissionMode?: string | undefined;
  /** A narrow screen: one row (command, Copy, Details toggle); the explanations open under it. */
  compact?: boolean;
}

/** The copy of the attach command: `copied` after a success, `failure` (with the command to select by hand) when the clipboard is not available. */
function useCopyCommand(command: string | undefined): { copied: boolean; failure: string; copy: () => Promise<void> } {
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
  return { copied, failure, copy };
}

/**
 * The way into a background session that needs a terminal: the exact command, a Copy button, and (when the session waits) what it waits on. A permission prompt of a
 * background session cannot be answered from this page (documented: only `claude attach`), so this panel is the answer to "what do I do now". A clipboard that is
 * not available is said, never ignored. On a narrow screen (`compact`) it is one row with a details toggle (open at once while the session waits).
 */
export function BgAttach({ command, waitingFor, permissionMode, compact = false }: BgAttachProps) {
  const { copied, failure, copy } = useCopyCommand(command);
  const [open, setOpen] = useState(waitingFor !== undefined);
  const tone = waitingFor === undefined ? 'border-border' : 'border-warning bg-warning-bg text-warning-text';
  const failureNote =
    failure !== '' ? (
      <p role="alert" className="text-xs text-danger-text">
        {failure}
      </p>
    ) : null;
  if (compact) {
    return (
      <div data-bg-attach="" data-bg-compact="" className={`flex flex-col gap-1 rounded border px-2 py-1 text-xs ${tone}`}>
        <div className="flex flex-nowrap items-center gap-1">
          {command === undefined ? (
            <span className="min-w-0 flex-1 truncate text-muted">The attach command is not known yet.</span>
          ) : (
            <code data-bg-attach-command="" className={ATTACH_COMMAND}>
              {command}
            </code>
          )}
          {command === undefined ? null : <IconButton aria-label={copied ? 'Copied' : 'Copy command'} icon={copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />} onClick={() => void copy()} />}
          <IconButton aria-label="Details" aria-expanded={open} icon={open ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronDown aria-hidden="true" className="h-4 w-4" />} onClick={() => setOpen(!open)} />
        </div>
        {open ? (
          <div data-bg-details="" className="flex flex-col gap-1">
            <p className="font-medium">{waitingFor === undefined ? 'Open it in a terminal' : `Answer in a terminal: this session waits on a ${waitingFor}`}</p>
            {waitingFor === undefined ? null : <p>A background session cannot be answered from this page: attach to it, answer there, then detach.</p>}
            <BgLimits permissionMode={permissionMode} asList />
          </div>
        ) : null}
        {failureNote}
      </div>
    );
  }
  return (
    <div data-bg-attach="" className={`flex flex-col gap-1 rounded border px-3 py-2 text-sm ${tone}`}>
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
            <ButtonAction variant="secondary" size="sm" onClick={() => void copy()} icon={copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />} label={copied ? 'Copied' : 'Copy command'} />
          </>
        )}
      </div>
      {failureNote}
    </div>
  );
}
