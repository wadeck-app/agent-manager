import { LoaderCircle, MessageSquareShare } from 'lucide-react';
import { useState } from 'react';
import { failureText, requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { MAX_NAME_CHARS } from '../logic/launchForm.js';
import { isOwned } from '../logic/owned.js';
import { THREAD_MEANING, quoteIsLong, shortMessage, threadBody, threadLimitLine } from '../logic/threadForm.js';
import { useDaemonDown } from '../owned/DaemonState.js';
import { useLiveThreads } from '../owned/LiveThreads.js';
import { useOwnedSession } from '../owned/useOwnedSession.js';
import { DaemonNotRunning } from './DaemonNotRunning.js';
import { ModelModeOptions } from './ModelModeOptions.js';
import { threadNameOf } from '../shared.js';
import type { OwnedSessionDto, OwnedSessionResponse } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { ButtonAction, FieldText, Tooltip } from '@wadeck-app/dsl-ui';
import { DialogActions } from '../ui/DialogActions.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { Modal } from '../ui/Modal.js';
import { RowButton } from '../ui/RowButton.js';

export interface ThreadDialogProps {
  /** The session the thread branches from (owned or discovered). */
  session: AgentRow;
  /** The message the thread stops at: the transcript uuid of the log row and its text. */
  anchor: { uuid: string; text: string };
  onClose: () => void;
  /** The daemon started the thread: the record it returned (the page lists and selects it). */
  onStarted: (session: OwnedSessionDto) => void;
}

/**
 * The Thread dialog, a compact Fork on one message: a title and one sentence, the message as a three-line preview (show full on demand), a name, the model and
 * permission mode folded in "Options", the folder as a small muted line. Model and mode start at the ones of the source when it is an owned session (its record
 * knows them; the button waits until the record is read, so nothing is sent from a guess), else Claude Code decides. The cap of live threads shows as a caption
 * from two on and as an error (the start is off) when it is reached; the refusals of the daemon (unknown message) are shown with their fix and the dialog stays open.
 */
export function ThreadDialog({ session, anchor, onClose, onStarted }: ThreadDialogProps) {
  const needsRecord = isOwned(session) && (session.host === 'stream-json' || session.host === 'bg');
  const { dto, error: readError } = useOwnedSession(session.sessionId, session.ownedState, needsRecord);
  const recordPending = needsRecord && dto === undefined;
  const [name, setName] = useState(threadNameOf(anchor.text));
  const [chosenModel, setChosenModel] = useState<string | undefined>(undefined);
  const [chosenMode, setChosenMode] = useState<string | undefined>(undefined);
  const [full, setFull] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const model = chosenModel ?? dto?.model ?? '';
  const mode = chosenMode ?? dto?.permissionMode ?? '';
  const nameText = name.trim().length > MAX_NAME_CHARS ? `The name has ${name.trim().length} characters, the limit is ${MAX_NAME_CHARS}.` : '';
  // The daemon is known to be down: nothing can start, said with the fix instead of a click that fails.
  const daemonDown = useDaemonDown();
  const limit = threadLimitLine(useLiveThreads(session.sessionId));
  const blocked = starting || nameText !== '' || recordPending || daemonDown || limit?.tone === 'error';
  const long = quoteIsLong(anchor.text);
  const known = dto?.model !== undefined || dto?.permissionMode !== undefined;

  const start = async (): Promise<void> => {
    if (blocked) {
      return;
    }
    setStarting(true);
    setError('');
    const result = await requestJson<OwnedSessionResponse>('/owned/fork', { method: 'POST', body: threadBody({ sourceSessionId: session.sessionId, atMessageId: anchor.uuid, atMessageQuote: shortMessage(anchor.text), name, model, permissionMode: mode }) });
    setStarting(false);
    if (!result.ok) {
      setError(result.text);
      return;
    }
    if (!result.value.ok) {
      setError(failureText(result.value, 200));
      return;
    }
    onStarted(result.value.session);
    onClose();
  };

  return (
    <Modal title="Start a side thread" onClose={onClose} dismissible={!starting} size="narrow">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <p className="text-sm text-content">{THREAD_MEANING}</p>
        <div>
          <blockquote data-thread-quote="" className={`whitespace-pre-wrap break-words rounded border-l-2 border-primary bg-muted-bg px-2.5 py-1.5 text-sm text-content ${full ? '' : 'line-clamp-3'}`}>
            {anchor.text.trim()}
          </blockquote>
          {long ? (
            <RowButton type="button" aria-expanded={full} onClick={() => setFull(!full)} className={`mt-1 rounded text-xs text-primary underline hover:no-underline ${FOCUS_RING}`}>
              {full ? 'Show less' : 'Show full'}
            </RowButton>
          ) : null}
        </div>
        {daemonDown ? <DaemonNotRunning what="start a thread" enables="Start thread" /> : null}
        {recordPending && !daemonDown ? (readError !== '' ? <Banner tone="error">{`The daemon record of this session could not be read, so the thread stays off: its model and permission mode are not known. ${readError}`}</Banner> : <p role="status" className="text-sm text-muted">Reading the model and permission mode of this session...</p>) : null}

        <FieldText label="Name" value={name} onChange={setName} disabled={starting} autoComplete="off" error={nameText} />

        <ModelModeOptions
          model={model}
          mode={mode}
          onModel={setChosenModel}
          onMode={setChosenMode}
          known={known}
          changed={chosenModel !== undefined || chosenMode !== undefined}
          busy={starting}
          hint={known ? 'The thread starts with the model and permission mode this session was launched with (or the last mode you set). Open to change them.' : 'This session does not tell its model or permission mode, so Claude Code decides unless you choose one. Open to choose.'}
        />

        <Tooltip content={`Folder: ${session.cwd}`} describe={false}>
          <p data-tip-fit="" className="truncate text-xs text-muted">{`Folder: ${session.cwd}`}</p>
        </Tooltip>
        {limit === undefined ? null : limit.tone === 'caption' ? (
          <p data-thread-limit="caption" className="text-xs text-muted">
            {limit.text}
          </p>
        ) : (
          <p data-thread-limit="error" role="alert" className="text-sm text-hue-red">
            {limit.text}
          </p>
        )}
        {error !== '' ? <Banner tone="error">{error}</Banner> : null}
        {starting ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm animate-spin motion-reduce:animate-none" />
            Starting Claude Code on the conversation up to this message...
          </p>
        ) : null}

        <DialogActions>
          <ButtonAction variant="secondary" label="Cancel" onClick={onClose} disabled={starting} />
          <ButtonAction variant="primary" type="submit" icon={<MessageSquareShare aria-hidden="true" className="h-4 w-4" />} label="Start thread" disabled={blocked} />
        </DialogActions>
      </form>
    </Modal>
  );
}
