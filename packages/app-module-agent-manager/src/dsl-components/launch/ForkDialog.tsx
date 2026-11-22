import { FOCUS_RING } from '../ui/focusRing.js';
import { GitFork, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { failureText, requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { FORK_MEANING, forkBody, forkBusyWarning, forkNameDefault, modelAliasOf } from '../logic/forkForm.js';
import { MODEL_OPTIONS, MAX_NAME_CHARS, PERMISSION_MODE_OPTIONS, type ChoiceOption } from '../logic/launchForm.js';
import { isOwned } from '../logic/owned.js';
import { useOwnedSession } from '../owned/useOwnedSession.js';
import type { OwnedSessionDto, OwnedSessionResponse } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { ButtonAction, FieldSelect, FieldText } from '@wadeck-app/dsl-ui';
import { DialogActions } from '../ui/DialogActions.js';
import { Modal } from '../ui/Modal.js';


export interface ForkDialogProps {
  /** The session to fork (owned or discovered). */
  session: AgentRow;
  onClose: () => void;
  /** The daemon started the fork: the record it returned (the page lists and selects it). */
  onForked: (session: OwnedSessionDto) => void;
}

/** The options of a select, plus the current value when the list does not know it (an exact model id an owned session was launched with). */
function withValue(options: readonly ChoiceOption[], value: string): readonly ChoiceOption[] {
  return value === '' || options.some((option) => option.value === value) ? options : [...options, { value, label: value }];
}

/**
 * The Fork dialog: a name ("fork of <name>"), a model and a permission mode. The fork is always a Web session (X1) in the folder of the source. Model and mode
 * start at the ones of the source when it is an owned session (its record knows them; Fork waits until the record is read, so nothing is sent from a guess),
 * else "Claude Code decides" (a discovered session does not tell its model id or its mode): only a choice of the user is sent. A working source gets a warning:
 * the fork starts from the transcript as written so far.
 */
export function ForkDialog({ session, onClose, onForked }: ForkDialogProps) {
  // The record of an owned session (model, mode at launch); a discovered session has none.
  const needsRecord = isOwned(session) && (session.host === 'stream-json' || session.host === 'bg');
  const { dto, error: readError } = useOwnedSession(session.sessionId, session.ownedState, needsRecord);
  const recordPending = needsRecord && dto === undefined;
  // undefined: the user did not touch the field, it follows the source (the record arrives after the dialog opens).
  const [name, setName] = useState(forkNameDefault(session));
  const [chosenModel, setChosenModel] = useState<string | undefined>(undefined);
  const [chosenMode, setChosenMode] = useState<string | undefined>(undefined);
  const [forking, setForking] = useState(false);
  const [error, setError] = useState('');

  const model = chosenModel ?? dto?.model ?? '';
  const mode = chosenMode ?? dto?.permissionMode ?? '';
  const nameText = name.trim().length > MAX_NAME_CHARS ? `The name has ${name.trim().length} characters, the limit is ${MAX_NAME_CHARS}.` : '';
  const blocked = forking || nameText !== '' || recordPending;
  const rowFamily = modelAliasOf(session.model);
  const busyWarning = forkBusyWarning(session);
  const modelKnown = dto?.model !== undefined;

  const fork = async (): Promise<void> => {
    if (blocked) {
      return;
    }
    setForking(true);
    setError('');
    const result = await requestJson<OwnedSessionResponse>('/owned/fork', { method: 'POST', body: forkBody({ sourceSessionId: session.sessionId, name, model, permissionMode: mode }) });
    setForking(false);
    if (!result.ok) {
      setError(result.text);
      return;
    }
    if (!result.value.ok) {
      setError(failureText(result.value, 200));
      return;
    }
    onForked(result.value.session);
    onClose();
  };

  return (
    <Modal title={`Fork ${session.displayName}`} onClose={onClose} dismissible={!forking}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void fork();
        }}
      >
        <p className="text-sm text-content">{FORK_MEANING}</p>
        {recordPending ? (readError !== '' ? <Banner tone="error">{`The daemon record of this session could not be read, so Fork stays off: its model and permission mode are not known. ${readError}`}</Banner> : <p role="status" className="text-sm text-muted">Reading the model and permission mode of this session...</p>) : null}
        {busyWarning !== undefined ? <Banner tone="warning">{busyWarning}</Banner> : null}

        <FieldText label="Name" value={name} onChange={setName} disabled={forking} autoComplete="off" error={nameText} description={'Shown in the list; the new session also shows that it was forked from this one.'} />

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldSelect label="Model" value={model} onChange={setChosenModel} options={[...withValue(MODEL_OPTIONS, model)]} disabled={forking} description={modelKnown ? 'The model this session was launched with.' : chosenModel !== undefined && chosenModel !== '' ? 'The alias is the latest model of its family.' : rowFamily !== '' ? `Claude Code decides. This session shows ${session.model?.displayName ?? rowFamily}: pick ${rowFamily} to stay in that family (an alias is the latest model of it).` : 'Not known for this session: Claude Code decides.'} />
          <FieldSelect label="Permission mode" value={mode} onChange={setChosenMode} options={[...withValue(PERMISSION_MODE_OPTIONS, mode)]} disabled={forking} description={dto?.permissionMode !== undefined ? 'The mode this session was launched with (or the last one you set).' : 'Not known for this session: Claude Code decides unless you choose one.'} />
        </div>

        <p className="text-xs text-muted">{`Folder: ${session.cwd}. It always starts as a Web session, whatever hosts the original.`}</p>
        {error !== '' ? <Banner tone="error">{error}</Banner> : null}
        {forking ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm animate-spin motion-reduce:animate-none" />
            Starting Claude Code on a copy of the conversation...
          </p>
        ) : null}

        <DialogActions>
          <ButtonAction variant="secondary" label="Cancel" onClick={onClose} disabled={forking} />
          <ButtonAction variant="primary" type="submit" icon={<GitFork aria-hidden="true" className="h-4 w-4" />} label="Fork" disabled={blocked} />
        </DialogActions>
      </form>
    </Modal>
  );
}
