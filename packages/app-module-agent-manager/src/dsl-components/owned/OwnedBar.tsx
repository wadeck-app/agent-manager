import { CircleStop, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { failureText, requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { PERMISSION_MODE_OPTIONS } from '../logic/launchForm.js';
import { isBgOwned, isLiveBg, isLiveWeb, isOwned } from '../logic/owned.js';
import type { OwnedForgetResponse, OwnedInterruptResponse, OwnedPermissionModeResponse, OwnedSessionDto, OwnedSessionResponse } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { FOCUS_RING, IconButton } from '../ui/IconButton.js';
import { BgAttach } from './BgAttach.js';
import { HostBadge } from './OwnedChips.js';
import { OwnedStateChip } from './OwnedStateChip.js';
import { SwitchAction } from './SwitchAction.js';
import { useOwnedSession } from './useOwnedSession.js';
import type { OwnedChange } from '../workspace/useOwnedRows.js';

export interface OwnedBarProps {
  session: AgentRow;
  /** A change the daemon confirmed: the list shows it before the next poll. */
  onChange: (change: OwnedChange) => void;
  /** The session was forgotten: the page leaves its detail. */
  onForgotten: () => void;
}

type Pending = 'stop' | 'resume' | 'forget';

/** The honest text of a resume: what comes back and what does not. */
export const RESUME_TEXT = 'Resume restores the conversation: Claude Code reloads the transcript. The turn that was running when the daemon ended is NOT replayed: send your message again if you still want it.';

/** Why a background session has no Interrupt: claude has no stop-turn command (checked in `claude --help` and the documented commands), only the terminal. */
export const BG_NO_INTERRUPT = 'A background session has no remote interrupt: claude has no stop-turn command, attach and press Esc in the terminal.';
export const BG_NO_MODE = 'The permission mode of a background session cannot be changed remotely.';

const MODE_SELECT = `h-am-hit rounded border border-border bg-surface px-2 text-sm text-content disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;
const ACTION = `inline-flex h-am-hit items-center gap-1.5 rounded border border-border px-3 text-sm text-content hover:bg-muted-bg disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;

/**
 * What the header adds for a session launched from agent-manager: its host and state, then the actions that fit its state (Interrupt a running turn, Stop a
 * live Web session, Resume an interrupted or exited one, Forget an ended one, the permission mode of a live Web session). Every action is one request through
 * the module (CSRF checked); a refusal is written under the buttons with its hint. Renders nothing for a discovered session.
 */
export function OwnedBar({ session, onChange, onForgotten }: OwnedBarProps) {
  const owned = isOwned(session);
  const { dto, error: readError, refresh } = useOwnedSession(session.sessionId, session.ownedState, owned && (session.host === 'stream-json' || session.host === 'bg'));
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [dialogError, setDialogError] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  if (!owned) {
    return null;
  }

  const id = encodeURIComponent(session.sessionId);
  const bg = isBgOwned(session);
  const liveBg = isLiveBg(session);
  const liveWeb = isLiveWeb(session);
  const live = liveWeb || liveBg;
  const ended = session.ownedState === 'interrupted' || session.ownedState === 'exited';
  const resumable = dto?.resumable === true;
  const leftover = dto?.leftoverPid;

  const closeDialog = (): void => {
    setPending(undefined);
    setDialogError('');
  };

  /** Runs one request; a failure goes where the user looks (the dialog when one is open, else under the buttons). */
  const run = async <T,>(work: () => Promise<{ ok: true; value: T } | { ok: false; text: string }>, accept: (value: T) => string | undefined): Promise<boolean> => {
    setBusy(true);
    setError('');
    setNote('');
    setDialogError('');
    const result = await work();
    setBusy(false);
    if (!result.ok) {
      (pending === undefined ? setError : setDialogError)(result.text);
      return false;
    }
    const failure = accept(result.value);
    if (failure !== undefined) {
      (pending === undefined ? setError : setDialogError)(failure);
      return false;
    }
    return true;
  };

  const takeSession = (value: OwnedSessionResponse): OwnedSessionDto | undefined => (value.ok ? value.session : undefined);

  const interrupt = async (): Promise<void> => {
    const done = await run(
      () => requestJson<OwnedInterruptResponse>(`/owned/${id}/interrupt`, { method: 'POST' }),
      (value) => (value.ok ? undefined : failureText(value, 200)),
    );
    if (done) {
      setNote('The running turn was interrupted.');
      refresh();
    }
  };

  const stop = async (): Promise<void> => {
    let stopped: OwnedSessionDto | undefined;
    const done = await run(
      () => requestJson<OwnedSessionResponse>(`/owned/${id}/stop`, { method: 'POST' }),
      (value) => {
        stopped = takeSession(value);
        return stopped === undefined ? failureText(value, 200) : undefined;
      },
    );
    if (done && stopped !== undefined) {
      closeDialog();
      onChange({ kind: 'updated', session: stopped });
      refresh();
      setNote('The session was stopped.');
    }
  };

  const resume = async (): Promise<void> => {
    let resumed: OwnedSessionDto | undefined;
    const done = await run(
      () => requestJson<OwnedSessionResponse>(`/owned/${id}/resume`, { method: 'POST', ...(leftover === undefined ? {} : { body: { acknowledgeLeftover: true } }) }),
      (value) => {
        resumed = takeSession(value);
        return resumed === undefined ? failureText(value, 200) : undefined;
      },
    );
    if (done && resumed !== undefined) {
      closeDialog();
      onChange({ kind: 'updated', session: resumed });
      refresh();
      setNote(bg ? 'The session was restarted with claude respawn: its conversation comes back.' : 'The session was resumed. Send your message again if the lost turn still matters.');
    }
  };

  const forget = async (): Promise<void> => {
    const done = await run(
      () => requestJson<OwnedForgetResponse>(`/owned/${id}/forget`, { method: 'POST' }),
      (value) => (value.ok ? undefined : failureText(value, 200)),
    );
    if (done) {
      closeDialog();
      onChange({ kind: 'forgotten', id: session.sessionId });
      onForgotten();
    }
  };

  const setMode = async (mode: string): Promise<void> => {
    const done = await run(
      () => requestJson<OwnedPermissionModeResponse>(`/owned/${id}/permission-mode`, { method: 'POST', body: { mode } }),
      (value) => (value.ok ? undefined : failureText(value, 200)),
    );
    if (done) {
      setNote(`The permission mode is now ${mode}.`);
      refresh();
    }
  };

  const mode = dto?.permissionMode ?? '';
  const modeOptions = PERMISSION_MODE_OPTIONS.filter((option) => option.value !== '');
  const unknownMode = mode !== '' && !modeOptions.some((option) => option.value === mode);

  return (
    <div data-owned-bar="" className="mt-1.5 flex flex-col gap-1.5">
      {session.ownedState === 'interrupted' ? (
        <Banner tone="warning">
          <p className="font-medium">This session was interrupted: the daemon that ran it ended while it was live.</p>
          {/* The daemon's own note says the same in its words; the fixed text only fills in while it is not known yet. */}
          {dto?.note !== undefined && dto.note !== '' ? <p>{dto.note}</p> : dto === undefined || resumable ? <p>{RESUME_TEXT}</p> : null}
        </Banner>
      ) : null}
      {session.switchFailure !== undefined && !session.alive ? (
        <Banner tone="warning">
          <p className="font-medium">{`The last move to ${session.switchFailure.target === 'hc' ? 'Terminal' : 'Web'} failed after the old host was stopped.`}</p>
          <p>{session.switchFailure.reason}</p>
          <p>Nothing runs now. Use the Start button to try again on that host.</p>
        </Banner>
      ) : null}
      {session.ownedState === 'exited' && dto?.exit !== undefined ? (
        <Banner tone="info">
          <p>{`The claude process ended (${dto.exit.cause}${dto.exit.code === null ? '' : `, exit code ${dto.exit.code}`}).`}</p>
          {dto.exit.stderrTail !== '' ? <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-am-mono">{dto.exit.stderrTail}</pre> : null}
        </Banner>
      ) : null}
      {session.ownedState === 'exited' && dto !== undefined && !resumable && dto.note !== undefined && dto.note !== '' ? <Banner tone="info">{dto.note}</Banner> : null}
      {readError !== '' && (session.host === 'stream-json' || bg) ? <Banner tone="warning">{`The daemon record of this session could not be read, so some actions may be missing. ${readError}`}</Banner> : null}

      {bg && dto?.observeError !== undefined ? <Banner tone="warning">{`The daemon could not read the state of background sessions (claude agents --json), so the state shown may be stale: ${dto.observeError}`}</Banner> : null}
      {liveBg ? <BgAttach command={dto?.attachCommand} waitingFor={session.ownedState === 'requires_action' ? (dto?.waitingFor ?? 'prompt') : undefined} /> : null}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <HostBadge session={session} />
        <OwnedStateChip session={session} />
        {dto?.model !== undefined ? <span className="text-xs text-muted">{`launched with model ${dto.model}`}</span> : null}
        {liveWeb && session.ownedState === 'running' ? (
          <button type="button" disabled={busy} onClick={() => void interrupt()} className={ACTION}>
            <Square aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            Interrupt
          </button>
        ) : null}
        {liveBg ? (
          <button type="button" disabled title={BG_NO_INTERRUPT} aria-describedby="bg-no-interrupt" className={ACTION}>
            <Square aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            Interrupt
          </button>
        ) : null}
        {live ? (
          <button type="button" disabled={busy} onClick={() => setPending('stop')} className={ACTION}>
            <CircleStop aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            Stop
          </button>
        ) : null}
        <SwitchAction session={session} disabled={busy} onChange={onChange} onNote={setNote} onError={setError} />
        {ended && resumable ? (
          <button type="button" disabled={busy} onClick={() => (leftover === undefined ? void resume() : setPending('resume'))} className={`${ACTION} border-primary bg-primary-light text-primary`}>
            <RotateCcw aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            {leftover === undefined ? (bg ? 'Resume (claude respawn)' : 'Resume') : 'Resume anyway'}
          </button>
        ) : null}
        {ended ? <IconButton icon={Trash2} label="Forget" disabled={busy} onClick={() => setPending('forget')} /> : null}
        {liveWeb ? (
          <label className="flex items-center gap-1.5 text-sm text-muted">
            Mode
            <select
              aria-label="Permission mode"
              value={mode}
              disabled={busy || dto === undefined}
              onChange={(event) => void setMode(event.target.value)}
              className={MODE_SELECT}
            >
              {mode === '' ? (
                <option value="" disabled>
                  (not reported)
                </option>
              ) : null}
              {unknownMode ? <option value={mode}>{mode}</option> : null}
              {modeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {liveBg ? (
        <details data-bg-limits="" className="text-xs text-muted">
          <summary className={`cursor-pointer rounded ${FOCUS_RING}`}>Why are Interrupt and Permission mode not available?</summary>
          <ul className="mt-1 list-none">
            <li id="bg-no-interrupt">{BG_NO_INTERRUPT}</li>
            <li id="bg-no-mode" data-bg-no-mode="">
              <label className="inline-flex items-center gap-1.5">
                Mode
                <select aria-label="Permission mode" disabled title={BG_NO_MODE} aria-describedby="bg-no-mode" value={dto?.permissionMode ?? ''} onChange={() => undefined} className={MODE_SELECT}>
                  <option value={dto?.permissionMode ?? ''}>{dto?.permissionMode ?? '(set at launch)'}</option>
                </select>
              </label>{' '}
              {BG_NO_MODE}
            </li>
          </ul>
        </details>
      ) : null}

      {note !== '' ? (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      ) : null}
      {error !== '' ? (
        <Banner
          tone="error"
          action={
            <button type="button" onClick={() => setError('')} className={`shrink-0 rounded border border-danger px-2 py-0.5 text-xs ${FOCUS_RING}`}>
              Dismiss
            </button>
          }
        >
          {error}
        </Banner>
      ) : null}

      {pending === 'stop' ? (
        <ConfirmDialog title="Stop this session?" confirmLabel="Stop the session" danger busy={busy} error={dialogError} onConfirm={() => void stop()} onCancel={closeDialog}>
          {bg ? (
            <>
              <p>The session ends: agent-manager runs claude stop for it, so the supervisor stops its process and a turn that is running stops with it.</p>
              <p>The conversation is kept. The session stays in the list as exited, and Resume restarts it with claude respawn.</p>
            </>
          ) : (
            <>
              <p>The session ends: its claude process is stopped, and a turn that is running stops with it.</p>
              <p>The conversation stays on disk. The session stays in the list as exited, and you can resume it from here.</p>
            </>
          )}
        </ConfirmDialog>
      ) : null}
      {pending === 'resume' ? (
        <ConfirmDialog title="Resume although a claude process may still run?" confirmLabel="Resume anyway" danger busy={busy} error={dialogError} onConfirm={() => void resume()} onCancel={closeDialog}>
          <p>{`A claude process of the old daemon (pid ${String(leftover)}) may still be alive for this session. Resuming starts a second one on the same conversation.`}</p>
          <p>Check that the process is gone (Task Manager, or ps) before you go on.</p>
          <p>{RESUME_TEXT}</p>
        </ConfirmDialog>
      ) : null}
      {pending === 'forget' ? (
        <ConfirmDialog title="Forget this session?" confirmLabel="Forget it" danger busy={busy} error={dialogError} onConfirm={() => void forget()} onCancel={closeDialog}>
          {bg ? <p>The session leaves the list, and agent-manager runs claude rm for it: it is also removed from the Claude Code supervisor (and from claude agents), with the worktree Claude Code made for it when that is safe to delete. It can no longer be resumed from here.</p> : <p>The session leaves the list and the daemon forgets it, so it can no longer be resumed from here.</p>}
          <p>The transcript file of Claude Code stays on disk.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
