import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AgentRow, SessionStatusDto } from '../deps.js';
import { Tooltip } from '../deps.js';
import { BypassChips } from './BypassChips.js';
import { CHIP } from './chipStyle.js';
import { ContextMeter } from './ContextMeter.js';
import { CwdBranch } from './CwdBranch.js';
import { DurationChip } from './DurationChip.js';
import { formatSpan, formatTokens } from './format.js';
import { HarnessChip } from './HarnessChip.js';
import { harnessChip } from './harness.js';
import { ModelChip } from './ModelChip.js';
import { RoleChip } from './RoleChip.js';
import { SessionIdChip } from './SessionIdChip.js';
import { TokenCounts } from './TokenCounts.js';
import { useChipFit } from './useChipFit.js';

/** One droppable chip: what it draws, and the short text the "+N" tooltip lists when it does not fit. */
type Droppable = { key: string; node: ReactNode; text: string };

/**
 * What the Claude Code status line shows, for the open session: the working directory with its branch, then ONE row of chips under it (model, context, role
 * and bypasses always; tokens, duration, session id, program and pid while they fit). What does not fit leaves the row, least important first (pid, program,
 * session id, duration, tokens), and is listed in the tooltip of a "+N" chip; only when even that is not enough does the row wrap. A field that is not
 * available is simply not drawn (no empty slot); the reason it is not available (`statusNote`), a branch that could not be read or a broken bypass file is
 * shown as a warning, never swallowed.
 */
export function StatusInfo({ session, status, collapsed = false, wrapAll = false }: { session: AgentRow; status: SessionStatusDto; collapsed?: boolean; wrapAll?: boolean }) {
  const hasTokens = status.tokensIn !== undefined || status.tokensOut !== undefined;
  // Most important first: the LAST ones leave the row first.
  const droppable: Droppable[] = [];
  if (hasTokens) {
    const text = [status.tokensIn === undefined ? undefined : `${formatTokens(status.tokensIn)} in`, status.tokensOut === undefined ? undefined : `${formatTokens(status.tokensOut)} out`].filter((part) => part !== undefined).join(' / ');
    droppable.push({ key: 'tokens', node: <TokenCounts tokensIn={status.tokensIn} tokensOut={status.tokensOut} />, text: `tokens ${text}` });
  }
  if (status.durationMs !== undefined) {
    droppable.push({ key: 'duration', node: <DurationChip durationMs={status.durationMs} />, text: `running ${formatSpan(status.durationMs)}` });
  }
  droppable.push({ key: 'session', node: <SessionIdChip sessionId={session.sessionId} name={session.displayName} />, text: `session ${session.sessionId}` });
  if (session.harness !== undefined) {
    droppable.push({ key: 'harness', node: <HarnessChip harness={session.harness} />, text: harnessChip(session.harness).full });
  }
  if (session.pid > 0) {
    droppable.push({ key: 'pid', node: <span className="tabular-nums">pid {session.pid}</span>, text: `pid ${session.pid}` });
  }
  const { ref, dropped, wrap } = useChipFit(droppable.length, droppable.map((item) => item.key + item.text).join('\n'));
  // wrapAll (the Details panel, which has the room to grow): nothing leaves, the chips wrap onto more lines.
  const shown = wrapAll ? droppable : droppable.slice(0, droppable.length - dropped);
  const gone = wrapAll ? [] : droppable.slice(droppable.length - dropped);
  return (
    <div data-status-info="" className="mt-0.5 flex flex-col gap-1 text-xs text-muted">
      <CwdBranch cwd={session.cwd} branch={status.gitBranch} branchError={status.gitBranchError} />
      {collapsed && (status.model !== undefined || status.contextUsedPct !== undefined) ? (
        <div data-status-summary="" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {status.model === undefined ? null : <ModelChip model={status.model} previous={status.previousModels} />}
          {status.contextUsedPct === undefined ? null : <ContextMeter context={status.contextUsedPct} />}
        </div>
      ) : null}
      {/* Collapsed (short screens, or by the user): the folder line stays, the chips go; the warnings below always stay. */}
      <div ref={ref} data-status-chips="" className={`${collapsed ? 'hidden' : 'flex'} items-center gap-x-2 gap-y-1 ${wrap || wrapAll ? 'flex-wrap' : 'flex-nowrap overflow-x-clip whitespace-nowrap'}`}>
        {status.model === undefined ? null : <ModelChip model={status.model} previous={status.previousModels} />}
        {status.contextUsedPct === undefined ? null : <ContextMeter context={status.contextUsedPct} />}
        {status.role === undefined ? null : <RoleChip role={status.role} />}
        <BypassChips bypasses={status.bypasses} error={status.bypassError} />
        {shown.map((item) => (
          <span key={item.key} className="inline-flex shrink-0 items-center">
            {item.node}
          </span>
        ))}
        {gone.length === 0 ? null : (
          <Tooltip content={`Not enough room for: ${gone.map((item) => item.text).join('; ')}.`}>
            <span tabIndex={0} aria-label={`${gone.length} more: ${gone.map((item) => item.text).join(', ')}`} className={`${CHIP} shrink-0 tabular-nums`}>
              +{gone.length}
            </span>
          </Tooltip>
        )}
      </div>
      {status.statusNote === undefined || status.statusNote === '' ? null : (
        <p role="status" className="inline-flex items-center gap-1 text-warning-text">
          <TriangleAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
          {status.statusNote}
        </p>
      )}
    </div>
  );
}
