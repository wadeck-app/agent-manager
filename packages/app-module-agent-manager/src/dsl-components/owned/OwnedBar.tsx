import { ButtonAction, CompactSelect, IconButton } from '@wadeck-app/dsl-ui';
import { CircleStop, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Scope } from '../ui/Scope.js';
import { failureText, requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { MOVE_DAEMON_DOWN } from '../logic/adoptSwitch.js';
import { PERMISSION_MODE_OPTIONS } from '../logic/launchForm.js';
import { isBgOwned, isLiveBg, isLiveWeb, isOwned } from '../logic/owned.js';
import type { OwnedForgetResponse, OwnedInterruptResponse, OwnedPermissionModeResponse, OwnedSessionDto, OwnedSessionResponse } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { useMediaQuery } from '../ui/hooks.js';
import { BgAttach } from './BgAttach.js';
import { BG_NO_INTERRUPT, BG_NO_MODE, BgLimits } from './BgLimits.js';
import { HostBadge } from './OwnedChips.js';
import { OwnedStateChip } from './OwnedStateChip.js';
import { DAEMON_DOWN_REASON, useDaemonDown } from './DaemonState.js';
import { useUiVariant } from '../ui/UiVariants.js';
import { MoveBanner } from './MoveBanner.js';
import { SwitchAction } from './SwitchAction.js';
import { useOwnedSession } from './useOwnedSession.js';
import type { OwnedChange } from '../workspace/useOwnedRows.js';

const STDERR_TAIL = 'mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-am-mono';

export interface OwnedBarProps {
  session: AgentRow;
  /** A change the daemon confirmed: the list shows it before the next poll. */
  onChange: (change: OwnedChange) => void;
  /** The session was forgotten: the page leaves its detail. */
  onForgotten: () => void;
  /** The one-line header: the controls go into `slot` as icon buttons (nothing is drawn until the header gave its slot), and the notices stay here. Absent: the controls row of the detailed header. */
  inline?: { slot: HTMLElement | null };
}

type Pending = 'stop' | 'resume' | 'forget';

/** The honest text of a resume: what comes back and what does not. */
export const RESUME_TEXT = 'Resume restores the conversation: Claude Code reloads the transcript. The turn that was running when the daemon ended is NOT replayed: send your message again if you still want it.';

// The texts live with the panel that shows them (BgAttach).
export { BG_NO_INTERRUPT, BG_NO_MODE };


/**
 * What the header adds for a session launched from agent-manager: its host and state, then the actions that fit its state (Interrupt a running turn, Stop a
 * live Web session, Resume an interrupted or exited one, Forget an ended one, the permission mode of a live Web session). Every action is one request through
 * the module (CSRF checked); a refusal is written under the buttons with its hint. Renders nothing for a discovered session.
 */
export function OwnedBar({ session, onChange, onForgotten, inline }: OwnedBarProps) {
  const owned = isOwned(session);
  const { dto, error: readError, refresh } = useOwnedSession(session.sessionId, session.ownedState, owned && (session.host === 'stream-json' || session.host === 'bg'));
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [dialogError, setDialogError] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  // The daemon is known to be down: Stop, Resume, Interrupt and Forget are off with the reason and the fix, instead of a click that fails.
  const daemonDown = useDaemonDown();
  const readinessStyle = useUiVariant('switchReadiness');
  // A phone: the attach card and the explanations of a background session become one row with a details toggle.
  const narrow = useMediaQuery('(max-width: 639px)');
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

  const modeSelect = (
    <label className="flex items-center gap-1.5 text-sm text-muted">
      Mode
      <CompactSelect
        ariaLabel="Permission mode"
        value={mode}
        disabled={busy || dto === undefined || daemonDown}
        onChange={(next) => void setMode(next)}
        options={[
          ...(mode === '' ? [{ value: '', label: '(not reported)' }] : []),
          ...(unknownMode ? [{ value: mode, label: mode }] : []),
          ...modeOptions.map((option) => ({ value: option.value, label: option.label })),
        ]}
      />
    </label>
  );
  // The one-line header (inline): the same actions as icon buttons in the header line (rendered into its slot), the permission mode in a thin row under it.
  const iconControls = (
    <>
      <HostBadge session={session} iconOnly />
      <OwnedStateChip session={session} iconOnly />
      {liveWeb && session.ownedState === 'running' ? <IconButton aria-label="Interrupt" icon={<Square aria-hidden="true" className="h-4 w-4" />} disabled={busy || daemonDown} {...(daemonDown ? { disabledReason: DAEMON_DOWN_REASON } : {})} onClick={() => void interrupt()} /> : null}
      {liveBg ? <IconButton aria-label="Interrupt" icon={<Square aria-hidden="true" className="h-4 w-4" />} disabled disabledReason={BG_NO_INTERRUPT} /> : null}
      {live ? <IconButton variant="danger-outline" aria-label="Stop" icon={<CircleStop aria-hidden="true" className="h-4 w-4" />} disabled={busy || daemonDown} {...(daemonDown ? { disabledReason: DAEMON_DOWN_REASON } : {})} onClick={() => setPending('stop')} /> : null}
      <SwitchAction session={session} disabled={busy} onChange={onChange} onNote={setNote} onError={setError} compact />
      {ended && resumable ? <IconButton variant="primary" aria-label={leftover === undefined ? (bg ? 'Resume (claude respawn)' : 'Resume') : 'Resume anyway'} icon={<RotateCcw aria-hidden="true" className="h-4 w-4" />} disabled={busy || daemonDown} {...(daemonDown ? { disabledReason: DAEMON_DOWN_REASON } : {})} onClick={() => (leftover === undefined ? void resume() : setPending('resume'))} /> : null}
      {ended ? <IconButton aria-label="Forget" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />} disabled={busy || daemonDown} {...(daemonDown ? { disabledReason: DAEMON_DOWN_REASON } : {})} onClick={() => setPending('forget')} /> : null}
    </>
  );

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
          {dto.exit.stderrTail !== '' ? <pre className={STDERR_TAIL}>{dto.exit.stderrTail}</pre> : null}
        </Banner>
      ) : null}
      {session.ownedState === 'exited' && dto !== undefined && !resumable && dto.note !== undefined && dto.note !== '' ? <Banner tone="info">{dto.note}</Banner> : null}
      {readError !== '' && (session.host === 'stream-json' || bg) ? <Banner tone="warning">{`The daemon record of this session could not be read, so some actions may be missing. ${readError}`}</Banner> : null}

      {bg && dto?.observeError !== undefined ? <Banner tone="warning">{`The daemon could not read the state of background sessions (claude agents --json), so the state shown may be stale: ${dto.observeError}`}</Banner> : null}
      {liveBg ? <BgAttach command={dto?.attachCommand} waitingFor={session.ownedState === 'requires_action' ? (dto?.waitingFor ?? 'prompt') : undefined} permissionMode={dto?.permissionMode} compact={narrow} /> : null}

      {inline === undefined ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <HostBadge session={session} />
          <OwnedStateChip session={session} />
          {dto?.model !== undefined ? <span className="text-xs text-muted">{`launched with model ${dto.model}`}</span> : null}
          {liveWeb && session.ownedState === 'running' ? (
            <ButtonAction variant="secondary" size="sm" disabled={busy || daemonDown} {...(daemonDown ? { disabledReason: DAEMON_DOWN_REASON } : {})} onClick={() => void interrupt()} icon={<Square aria-hidden="true" className="h-3.5 w-3.5" />} label="Interrupt" />
          ) : null}
          {liveBg ? (
            <ButtonAction variant="secondary" size="sm" disabled disabledReason={BG_NO_INTERRUPT} icon={<Square aria-hidden="true" className="h-3.5 w-3.5" />} label="Interrupt" />
          ) : null}
          {live ? (
            <ButtonAction variant="danger-outline" size="sm" disabled={busy || daemonDown} {...(daemonDown ? { disabledReason: DAEMON_DOWN_REASON } : {})} onClick={() => setPending('stop')} icon={<CircleStop aria-hidden="true" className="h-3.5 w-3.5" />} label="Stop" />
          ) : null}
          <SwitchAction session={session} disabled={busy} onChange={onChange} onNote={setNote} onError={setError} />
          {ended && resumable ? (
            <ButtonAction
              variant="primary"
              size="sm"
              disabled={busy || daemonDown}
              {...(daemonDown ? { disabledReason: DAEMON_DOWN_REASON } : {})}
              onClick={() => (leftover === undefined ? void resume() : setPending('resume'))}
              icon={<RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />}
              label={leftover === undefined ? (bg ? 'Resume (claude respawn)' : 'Resume') : 'Resume anyway'}
            />
          ) : null}
          {ended ? <IconButton icon={<Trash2 aria-hidden="true" className="h-3.5 w-3.5" />} aria-label="Forget" disabled={busy || daemonDown} {...(daemonDown ? { disabledReason: DAEMON_DOWN_REASON } : {})} onClick={() => setPending('forget')} /> : null}
          {liveWeb ? modeSelect : null}
        </div>
      ) : (
        <>
          {inline.slot === null ? null : createPortal(<Scope>{iconControls}</Scope>, inline.slot)}
          {readinessStyle === 'banner' ? <MoveBanner session={session} /> : null}
          {liveWeb ? <div data-owned-mode="" className="max-w-full [&_select]:max-w-[11rem]">{modeSelect}</div> : null}
        </>
      )}

      {daemonDown && (ended || liveBg) ? (
        <p data-daemon-down="" className="text-xs text-muted">
          {MOVE_DAEMON_DOWN}
        </p>
      ) : null}

      {liveBg && !narrow ? <BgLimits permissionMode={dto?.permissionMode} /> : null}

      {note !== '' ? (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      ) : null}
      {error !== '' ? (
        <Banner
          tone="error"
          action={
            <ButtonAction variant="secondary" size="sm" label="Dismiss" onClick={() => setError('')} />
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
