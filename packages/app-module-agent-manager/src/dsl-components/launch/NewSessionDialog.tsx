import { FOCUS_RING } from '../ui/focusRing.js';
import { Globe, LoaderCircle, Rocket, ServerCog, SquareTerminal } from 'lucide-react';
import { useState } from 'react';
import { failureText, requestJson } from '../data/http.js';
import {
  HOST_CHOICES,
  MODEL_OPTIONS,
  PERMISSION_MODE_OPTIONS,
  cwdProblem,
  launchBody,
  nameProblem,
  readLaunchPrefs,
  saveLaunchPrefs,
  type LaunchPrefs,
} from '../logic/launchForm.js';
import type { FolderPick } from '../logic/folderPicker.js';
import type { ApiError, OwnedHostKind, OwnedSessionDto, OwnedSessionResponse } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { ButtonAction, FieldSelect, FieldText, FieldWrapper } from '@wadeck-app/dsl-ui';
import { DialogActions } from '../ui/DialogActions.js';
import { Modal } from '../ui/Modal.js';
import { DaemonNotRunning } from './DaemonNotRunning.js';
import { FolderPicker } from '../folders/FolderPicker.js';

const HOST_ICON: Record<OwnedHostKind, typeof Globe> = { 'stream-json': Globe, hc: SquareTerminal, bg: ServerCog };

export interface NewSessionDialogProps {
  /** `ownedError` of GET /sessions: why the daemon cannot be asked, null when it answered. */
  ownedError: ApiError | null;
  ownedErrorText: string;
  onClose: () => void;
  /** The daemon accepted the launch: the session record it returned. */
  onLaunched: (session: OwnedSessionDto) => void;
}

/**
 * The New session dialog: where (folder), how it is hosted (Web session or Terminal session), the model and the permission mode, an optional name. The host,
 * model and mode are remembered (localStorage `agent-manager.launch.v1`); the folder and name are not. A daemon that is not running is said with its fix and
 * Launch stays disabled; any other problem with the daemon is shown as the server wrote it. A refused launch is written in the dialog with its hint.
 */
export function NewSessionDialog({ ownedError, ownedErrorText, onClose, onLaunched }: NewSessionDialogProps) {
  const [prefs, setPrefs] = useState<LaunchPrefs>(readLaunchPrefs);
  const [cwd, setCwd] = useState('');
  // What the picker knows of the folder in the field (name, branch): shown only while the field still holds that path.
  const [picked, setPicked] = useState<FolderPick | undefined>(undefined);
  const [name, setName] = useState('');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');
  const [prefsNote, setPrefsNote] = useState('');

  const daemonDown = ownedError?.code === 'daemon-not-running';
  const cwdText = cwdProblem(cwd);
  const nameText = nameProblem(name, prefs.hostKind);
  const blocked = daemonDown || cwd.trim() === '' || cwdText !== '' || nameText !== '' || launching;

  const change = (next: Partial<LaunchPrefs>): void => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    setPrefsNote(saveLaunchPrefs(merged));
  };

  const launch = async (): Promise<void> => {
    if (blocked) {
      return;
    }
    setLaunching(true);
    setError('');
    const result = await requestJson<OwnedSessionResponse>('/owned/launch', { method: 'POST', body: launchBody({ ...prefs, cwd, name }) });
    setLaunching(false);
    if (!result.ok) {
      setError(result.text);
      return;
    }
    if (!result.value.ok) {
      setError(failureText(result.value, 200));
      return;
    }
    onLaunched(result.value.session);
    onClose();
  };

  return (
    <Modal title="New session" onClose={onClose} dismissible={!launching}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void launch();
        }}
      >
        {daemonDown ? <DaemonNotRunning /> : ownedError !== null ? <Banner tone="error">{ownedErrorText !== '' ? ownedErrorText : `${ownedError.message}. ${ownedError.hint}`}</Banner> : null}

        <FieldWrapper label="Folder" error={cwdText} description="The absolute path of the project folder: type it, or choose it below. It must exist, and Claude Code asks for its trust the first time.">
          {(control) => (
          <FolderPicker
            inputId={control.id}
            value={cwd}
            onChange={setCwd}
            onPick={(pick) => {
              setPicked(pick);
              setCwd(pick.path);
            }}
            onKnow={setPicked}
            picked={picked}
            disabled={launching}
            invalid={cwdText !== ''}
            // violations-suppress: shared/no-out-of-repo-path an example of the path the user types, not a path the code reads
            placeholder="C:\Projects\shop"
          />
          )}
        </FieldWrapper>

        <fieldset className="flex flex-col gap-2" disabled={launching}>
          <legend className="mb-1 text-sm font-medium text-content">How it runs</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {HOST_CHOICES.map((choice) => {
              const Icon = HOST_ICON[choice.id];
              const selected = prefs.hostKind === choice.id;
              return (
                <label
                  key={choice.id}
                  className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${selected ? 'border-primary bg-primary-light' : 'border-border hover:bg-muted-bg'}`}
                >
                  <input type="radio" name="host" value={choice.id} checked={selected} onChange={() => change({ hostKind: choice.id })} className="mt-1.5 shrink-0" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-content">
                      <Icon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
                      {choice.label}
                    </span>
                    <span className="text-xs text-muted">{choice.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldSelect label="Model" value={prefs.model} onChange={(next) => change({ model: next })} options={[...MODEL_OPTIONS]} disabled={launching} />
          <FieldSelect label="Permission mode" value={prefs.permissionMode} onChange={(next) => change({ permissionMode: next })} options={[...PERMISSION_MODE_OPTIONS]} disabled={launching} description={prefs.hostKind === 'hc' ? 'Applied when Claude Code starts in the terminal.' : prefs.hostKind === 'bg' ? 'Applied at start; a background session cannot change it remotely.' : 'You can change it later from the session header.'} />
        </div>

        <FieldText label="Name (optional)" value={name} onChange={setName} disabled={launching} autoComplete="off" error={nameText} description={'Shown in the list instead of the folder name.'} />

        {prefs.hostKind === 'bg' ? (
          <p data-bg-trust-note="" className="text-xs text-muted">
            The folder must already be trusted by Claude Code: claude --bg refuses an untrusted folder. If it does, the error here says how to trust it (run claude once in that folder).
          </p>
        ) : null}
        {prefsNote !== '' ? <Banner tone="warning">{prefsNote}</Banner> : null}
        {error !== '' ? <Banner tone="error">{error}</Banner> : null}
        {launching ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm animate-spin motion-reduce:animate-none" />
            {prefs.hostKind === 'hc'
              ? 'Starting the terminal and waiting for Claude Code to register: this can take several seconds.'
              : prefs.hostKind === 'bg'
                ? 'Starting the background session (claude --bg) and waiting for the supervisor to list it: this can take several seconds.'
                : 'Starting Claude Code...'}
          </p>
        ) : null}

        <DialogActions>
          <ButtonAction variant="secondary" label="Cancel" onClick={onClose} disabled={launching} />
          <ButtonAction variant="primary" type="submit" icon={<Rocket aria-hidden="true" className="h-4 w-4" />} label="Launch" disabled={blocked} />
        </DialogActions>
      </form>
    </Modal>
  );
}
