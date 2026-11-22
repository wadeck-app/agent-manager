import { GitFork, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { failureText, requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { FORK_MEANING, forkBody, forkBusyWarning, forkNameDefault, modelAliasOf } from '../logic/forkForm.js';
import { MAX_NAME_CHARS } from '../logic/launchForm.js';
import { isOwned } from '../logic/owned.js';
import { useDaemonDown } from '../owned/DaemonState.js';
import { useOwnedSession } from '../owned/useOwnedSession.js';
import { DaemonNotRunning } from './DaemonNotRunning.js';
import { ModelModeOptions } from './ModelModeOptions.js';
import type { OwnedSessionDto, OwnedSessionResponse } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { ButtonAction, FieldText } from '@wadeck-app/dsl-ui';
import { DialogActions } from '../ui/DialogActions.js';
import { Modal } from '../ui/Modal.js';

export interface ForkDialogProps {
  /** The session to fork (owned or discovered). */
  session: AgentRow;
  onClose: () => void;
  /** The daemon started the fork: the record it returned (the page lists and selects it). */
  onForked: (session: OwnedSessionDto) => void;
}

/**
 * The Fork dialog, laid out like the Thread dialog: one sentence, a name ("fork of <name>"), the model and permission mode folded in "Options", the folder as a
 * small muted line. The fork is always a Web session (X1) in the folder of the source. Model and mode start at the ones of the source when it is an owned
 * session (its record knows them; Fork waits until the record is read, so nothing is sent from a guess), else "Claude Code decides" (a discovered session does
 * not tell its model id or its mode): only a choice of the user is sent. A working source gets a warning: the fork starts from the transcript as written so far.
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
  // The daemon is known to be down: nothing can start, said with the fix instead of a click that fails.
  const daemonDown = useDaemonDown();
  const blocked = forking || nameText !== '' || recordPending || daemonDown;
  const rowFamily = modelAliasOf(session.model);
  const busyWarning = forkBusyWarning(session);
  const known = dto?.model !== undefined || dto?.permissionMode !== undefined;
  // The long explanation is the tooltip of the Options line, never text of the dialog.
  const hint = known
    ? 'The fork starts with the model and permission mode this session was launched with (or the last mode you set). Open to change them.'
    : rowFamily !== ''
      ? `Claude Code decides. This session shows ${session.model?.displayName ?? rowFamily}: pick ${rowFamily} to stay in that family (an alias is the latest model of it).`
      : 'This session does not tell its model or permission mode, so Claude Code decides unless you choose one. Open to choose.';

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
    <Modal title={`Fork ${session.displayName}`} onClose={onClose} dismissible={!forking} size="narrow">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void fork();
        }}
      >
        <p className="text-sm text-content">{FORK_MEANING}</p>
        {daemonDown ? <DaemonNotRunning what="fork a session" enables="Fork" /> : null}
        {recordPending && !daemonDown ? (readError !== '' ? <Banner tone="error">{`The daemon record of this session could not be read, so Fork stays off: its model and permission mode are not known. ${readError}`}</Banner> : <p role="status" className="text-sm text-muted">Reading the model and permission mode of this session...</p>) : null}
        {busyWarning !== undefined ? <Banner tone="warning">{busyWarning}</Banner> : null}

        <FieldText label="Name" value={name} onChange={setName} disabled={forking} autoComplete="off" error={nameText} />

        <ModelModeOptions model={model} mode={mode} onModel={setChosenModel} onMode={setChosenMode} known={known} changed={chosenModel !== undefined || chosenMode !== undefined} busy={forking} hint={hint} />

        <p className="truncate text-xs text-muted" title={`Folder: ${session.cwd}`}>{`Folder: ${session.cwd}`}</p>
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
