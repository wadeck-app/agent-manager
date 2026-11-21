import { TriangleAlert } from 'lucide-react';
import type { AgentRow, SessionStatusDto } from '../deps.js';
import { BypassChips } from './BypassChips.js';
import { ContextMeter } from './ContextMeter.js';
import { CwdBranch } from './CwdBranch.js';
import { DurationChip } from './DurationChip.js';
import { ModelChip } from './ModelChip.js';
import { RoleChip } from './RoleChip.js';
import { SessionIdChip } from './SessionIdChip.js';
import { TokenCounts } from './TokenCounts.js';

/**
 * What the Claude Code status line shows, for the open session, as a compact wrapping row of chips under the name: the working directory with its branch, the
 * model, the context used, the tokens, the running time, the session id, the role and the bypasses. A field that is not available is simply not drawn (no empty
 * slot); the reason it is not available (`statusNote`), a branch that could not be read or a broken bypass file is shown as a warning, never swallowed.
 */
export function StatusInfo({ session, status, collapsed = false }: { session: AgentRow; status: SessionStatusDto; collapsed?: boolean }) {
  const hasTokens = status.tokensIn !== undefined || status.tokensOut !== undefined;
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
      <div data-status-chips="" className={`${collapsed ? 'hidden' : 'flex'} flex-wrap items-center gap-x-2 gap-y-1`}>
        {status.model === undefined ? null : <ModelChip model={status.model} previous={status.previousModels} />}
        {status.contextUsedPct === undefined ? null : <ContextMeter context={status.contextUsedPct} />}
        {hasTokens ? <TokenCounts tokensIn={status.tokensIn} tokensOut={status.tokensOut} /> : null}
        {status.durationMs === undefined ? null : <DurationChip durationMs={status.durationMs} />}
        {status.role === undefined ? null : <RoleChip role={status.role} />}
        <BypassChips bypasses={status.bypasses} error={status.bypassError} />
        {session.harness !== undefined ? <span className="rounded bg-muted-bg px-1.5 py-0.5 text-content">{session.harness}</span> : null}
        {session.pid > 0 ? <span className="tabular-nums">pid {session.pid}</span> : null}
        <SessionIdChip sessionId={session.sessionId} name={session.displayName} />
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
