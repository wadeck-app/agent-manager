import type { ReactNode } from 'react';
import { Folder, GitBranch, TriangleAlert } from 'lucide-react';
import type { AgentRow, SessionStatusDto } from './deps.js';
import { Tooltip } from './deps.js';
import { moveStatusOf } from '../logic/adoptSwitch.js';
import { shortenPath } from '../logic/shortenPath.js';
import { STATE_MEANING } from '../logic/states.js';
import { describeTimeInState, timeInState } from '../logic/time.js';
import { MoveBadgeView } from '../owned/MoveBadgeView.js';
import { useDaemonDown } from '../owned/DaemonState.js';
import { Chip } from '../ui/Chip.js';
import { STATE_LOOK, STATE_VARIANT } from '../ui/stateLook.js';
import { StatusIcon } from '../ui/StatusIcon.js';
import { BypassChips } from './status/BypassChips.js';
import { CHIP } from './status/chipStyle.js';
import { ContextMeter } from './status/ContextMeter.js';
import { DurationChip } from './status/DurationChip.js';
import { formatSpan, formatTokens } from './status/format.js';
import { HarnessChip } from './status/HarnessChip.js';
import { harnessChip } from './status/harness.js';
import { ModelChip } from './status/ModelChip.js';
import { RoleChip } from './status/RoleChip.js';
import { SessionIdChip } from './status/SessionIdChip.js';
import { TokenCounts } from './status/TokenCounts.js';
import { useChipFit } from './status/useChipFit.js';
import { CopyButton } from './log/CopyButton.js';

/** One droppable item of the line: what it draws, and the short text the "+N" tooltip lists when it does not fit. */
type Droppable = { key: string; node: ReactNode; text: string };

/** The characters of the folder path shown on the line (the middle is dots, the full path is the tooltip). */
const PATH_CHARS = 26;

/**
 * The whole identity and status of the open agent on ONE line: name, state, time in state, then (most important first) the folder with its branch, model,
 * context, what runs (Move readiness), role and bypasses, tokens, duration, program, session id, pid. Items leave the
 * line from the end of that list (the name keeps up to 26 characters before anything leaves) and are listed in the tooltip of a "+N" chip (measured on the real row by useChipFit); only when even
 * that is not enough does the name shrink and the state become an icon. A field that is not available is not drawn; a branch error or a broken bypass file stays visible as a warning. The actions are the caller's, at
 * the right of this line.
 */
export function HeaderLine({ session, status, now }: { session: AgentRow; status: SessionStatusDto; now: number }) {
  const look = STATE_LOOK[session.state];
  const since = timeInState(session.statusUpdatedAt, now);
  const daemonDown = useDaemonDown();
  const move = moveStatusOf(session, daemonDown);
  const droppable: Droppable[] = [];
  droppable.push({
    key: 'folder',
    text: `folder ${session.cwd}${status.gitBranch === undefined ? '' : ` (branch ${status.gitBranch})`}`,
    node: (
      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted">
        <Folder aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
        <span className="truncate" title={session.cwd}>
          {shortenPath(session.cwd, PATH_CHARS)}
        </span>
        {status.gitBranch === undefined ? null : (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-content" title={`Git branch ${status.gitBranch}`}>
            <GitBranch aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            <span className="sr-only">branch </span>
            {status.gitBranch}
          </span>
        )}
        {status.gitBranchError === undefined ? null : (
          <span role="alert" className="inline-flex shrink-0 items-center gap-0.5 text-warning-text" title={status.gitBranchError}>
            <TriangleAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            Branch unknown: {status.gitBranchError}
          </span>
        )}
        <CopyButton text={status.gitBranch === undefined ? session.cwd : `${session.cwd}::${status.gitBranch}`} label={status.gitBranch === undefined ? 'Copy the working directory' : 'Copy the working directory and branch'} />
      </span>
    ),
  });
  if (status.model !== undefined) {
    droppable.push({ key: 'model', node: <ModelChip model={status.model} previous={status.previousModels} />, text: `model ${status.model.displayName}` });
  }
  if (status.contextUsedPct !== undefined) {
    droppable.push({ key: 'context', node: <ContextMeter context={status.contextUsedPct} />, text: 'context used' });
  }
  if (move.badge !== undefined) {
    const title = move.unavailable === undefined ? move.badge.title : `${move.badge.title}
${move.unavailable}`;
    droppable.push({ key: 'move', node: <MoveBadgeView badge={{ ...move.badge, title }} />, text: move.unavailable === undefined ? move.badge.label : `${move.badge.label} (${move.unavailable})` });
  }
  if (status.role !== undefined || (status.bypasses?.length ?? 0) > 0 || status.bypassError !== undefined) {
    droppable.push({
      key: 'role',
      node: (
        <span className="inline-flex items-center gap-2">
          {status.role === undefined ? null : <RoleChip role={status.role} />}
          <BypassChips bypasses={status.bypasses} error={status.bypassError} />
        </span>
      ),
      text: [status.role === undefined ? undefined : `role ${status.role}`, (status.bypasses?.length ?? 0) > 0 ? 'bypass active' : undefined, status.bypassError === undefined ? undefined : `bypass file: ${status.bypassError}`].filter((part) => part !== undefined).join(', '),
    });
  }
  if (status.tokensIn !== undefined || status.tokensOut !== undefined) {
    const text = [status.tokensIn === undefined ? undefined : `${formatTokens(status.tokensIn)} in`, status.tokensOut === undefined ? undefined : `${formatTokens(status.tokensOut)} out`].filter((part) => part !== undefined).join(' / ');
    droppable.push({ key: 'tokens', node: <TokenCounts tokensIn={status.tokensIn} tokensOut={status.tokensOut} />, text: `tokens ${text}` });
  }
  if (status.durationMs !== undefined) {
    droppable.push({ key: 'duration', node: <DurationChip durationMs={status.durationMs} />, text: `running ${formatSpan(status.durationMs)}` });
  }
  if (session.harness !== undefined) {
    droppable.push({ key: 'harness', node: <HarnessChip harness={session.harness} />, text: harnessChip(session.harness).full });
  }
  droppable.push({ key: 'session', node: <SessionIdChip sessionId={session.sessionId} name={session.displayName} />, text: `session ${session.sessionId}` });
  if (session.pid > 0) {
    droppable.push({ key: 'pid', node: <span className="text-xs tabular-nums text-muted">pid {session.pid}</span>, text: `pid ${session.pid}` });
  }
  // `wrap` of the fit is true when even the bare line (name, state, age) does not fit: the name may then shrink and the state is an icon (the words are the tooltip).
  const { ref, dropped, wrap: tight } = useChipFit(droppable.length, droppable.map((item) => item.key + item.text).join('\n'));
  const shown = droppable.slice(0, droppable.length - dropped);
  const gone = droppable.slice(droppable.length - dropped);
  return (
    <div ref={ref} data-header-line="" className="flex min-w-[15rem] flex-1 flex-nowrap items-center gap-x-2 overflow-x-clip whitespace-nowrap">
      <h2 className={`max-w-[min(26ch,100%)] truncate text-base font-semibold text-content ${tight ? 'min-w-[8ch] shrink' : 'shrink-0'}`} title={session.displayName}>
        {session.displayName}
      </h2>
      <Tooltip content={STATE_MEANING[session.state]}>
        <Chip variant={STATE_VARIANT[session.state]} icon={<StatusIcon state={session.state} sizeClass="h-am-icon-sm w-am-icon-sm" labelled={false} />}>
                    {tight ? <span className="sr-only">{look.label}</span> : look.label}
        </Chip>
      </Tooltip>
      {since === '' ? null : (
        <Tooltip content={describeTimeInState(session.statusUpdatedAt, now)}>
          <span className="shrink-0 text-xs tabular-nums text-muted">{since}</span>
        </Tooltip>
      )}
      {shown.map((item) => (
        <span key={item.key} data-line-item={item.key} className="inline-flex shrink-0 items-center text-xs text-muted">
          {item.node}
        </span>
      ))}
      {gone.length === 0 ? null : (
        <Tooltip content={`Not enough room for: ${gone.map((item) => item.text).join('; ')}.`}>
          <span tabIndex={0} data-line-more="" aria-label={`${gone.length} more: ${gone.map((item) => item.text).join(', ')}`} className={`${CHIP} shrink-0 tabular-nums`}>
            +{gone.length}
          </span>
        </Tooltip>
      )}
    </div>
  );
}
