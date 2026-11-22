import { FOCUS_RING } from '../ui/focusRing.js';
import { LoaderCircle, MessageSquareShare } from 'lucide-react';
import { useState } from 'react';
import { failureText, requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { MODEL_OPTIONS, MAX_NAME_CHARS, PERMISSION_MODE_OPTIONS, type ChoiceOption } from '../logic/launchForm.js';
import { isOwned } from '../logic/owned.js';
import { THREAD_CAP_NOTE, THREAD_MEANING, shortMessage, threadBody } from '../logic/threadForm.js';
import { useOwnedSession } from '../owned/useOwnedSession.js';
import { threadNameOf } from '../shared.js';
import type { OwnedSessionDto, OwnedSessionResponse } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { ButtonAction, FieldSelect, FieldText } from '@wadeck-app/dsl-ui';
import { DialogActions } from '../ui/DialogActions.js';
import { Modal } from '../ui/Modal.js';


export interface ThreadDialogProps {
  /** The session the thread branches from (owned or discovered). */
  session: AgentRow;
  /** The message the thread stops at: the transcript uuid of the log row and its text. */
  anchor: { uuid: string; text: string };
  onClose: () => void;
  /** The daemon started the thread: the record it returned (the page lists and selects it). */
  onStarted: (session: OwnedSessionDto) => void;
}

const QUOTE_SHOWN_CHARS = 300;

/** The message as the dialog quotes it: at most 300 characters, the cut said with "...". */
function quoteOf(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= QUOTE_SHOWN_CHARS ? trimmed : `${trimmed.slice(0, QUOTE_SHOWN_CHARS)}...`;
}

function withValue(options: readonly ChoiceOption[], value: string): readonly ChoiceOption[] {
  return value === '' || options.some((option) => option.value === value) ? options : [...options, { value, label: value }];
}

/**
 * The Thread dialog, a compact Fork on one message: a name ("thread: <first 40 characters of the message>"), a model and a permission mode. Model and mode start
 * at the ones of the source when it is an owned session (its record knows them; the button waits until the record is read, so nothing is sent from a guess), else
 * Claude Code decides. The refusals of the daemon (unknown message, a fourth live thread) are shown with their fix and the dialog stays open.
 */
export function ThreadDialog({ session, anchor, onClose, onStarted }: ThreadDialogProps) {
  const needsRecord = isOwned(session) && (session.host === 'stream-json' || session.host === 'bg');
  const { dto, error: readError } = useOwnedSession(session.sessionId, session.ownedState, needsRecord);
  const recordPending = needsRecord && dto === undefined;
  const [name, setName] = useState(threadNameOf(anchor.text));
  const [chosenModel, setChosenModel] = useState<string | undefined>(undefined);
  const [chosenMode, setChosenMode] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const model = chosenModel ?? dto?.model ?? '';
  const mode = chosenMode ?? dto?.permissionMode ?? '';
  const nameText = name.trim().length > MAX_NAME_CHARS ? `The name has ${name.trim().length} characters, the limit is ${MAX_NAME_CHARS}.` : '';
  const blocked = starting || nameText !== '' || recordPending;

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
    <Modal title={`Thread on ${session.displayName}`} onClose={onClose} dismissible={!starting} size="narrow">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <blockquote className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded border-l-2 border-primary bg-muted-bg px-2.5 py-1.5 text-sm text-content">{quoteOf(anchor.text)}</blockquote>
        <p className="text-sm text-content">{THREAD_MEANING}</p>
        {recordPending ? (readError !== '' ? <Banner tone="error">{`The daemon record of this session could not be read, so the thread stays off: its model and permission mode are not known. ${readError}`}</Banner> : <p role="status" className="text-sm text-muted">Reading the model and permission mode of this session...</p>) : null}

        <FieldText label="Name" value={name} onChange={setName} disabled={starting} autoComplete="off" error={nameText} description={THREAD_CAP_NOTE} />

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldSelect label="Model" value={model} onChange={setChosenModel} options={[...withValue(MODEL_OPTIONS, model)]} disabled={starting} description={dto?.model !== undefined ? 'The model this session was launched with.' : 'Not known for this session: Claude Code decides unless you choose one.'} />
          <FieldSelect label="Permission mode" value={mode} onChange={setChosenMode} options={[...withValue(PERMISSION_MODE_OPTIONS, mode)]} disabled={starting} description={dto?.permissionMode !== undefined ? 'The mode this session was launched with (or the last one you set).' : 'Not known for this session: Claude Code decides unless you choose one.'} />
        </div>

        <p className="text-xs text-muted">{`Folder: ${session.cwd}. It always starts as a Web session.`}</p>
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
