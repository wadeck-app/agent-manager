import { Badge } from '@wadeck-app/dsl-ui';
import { PAGE_BASE } from '../data/http.js';
import { MONO, TD, TH } from '../guardrails/parts.js';
import { clockText } from '../logic/guardrails.js';
import type { SessionRowDto } from '../shared.js';
import { STATE_MEANING } from '../logic/states.js';
import { Chip } from '../ui/Chip.js';
import { Scope } from '../ui/Scope.js';
import { ScrollTable } from '../ui/ScrollTable.js';
import { StateChip } from '../ui/StateChip.js';

export interface SessionsTableProps {
  /** `$sources.sessions.sessions`: the rows of the page source (the page owns the poll). Absent while the first answer is awaited. */
  rows?: SessionRowDto[];
  /** `$sources.sessions.hiddenText`: the sentence that says how many dead sessions the filter hides. Empty or absent: none. */
  hiddenText?: string;
  /** `$sources.sessions.emptyText`: why there is nothing to list (no registry folder, only dead sessions...). Empty or absent: the plain "No session to show". */
  emptyText?: string;
}

/** What the registry says, with what it waits for when it says so: "busy", "waiting: permission prompt". */
function detailOf(row: SessionRowDto): string {
  return row.reason === '' ? row.status : `${row.status}: ${row.reason}`;
}

/**
 * The Table page: one row per session, every registry field in a column. A real table in a scroll region (ui/ScrollTable: a minimum width, a visible cue
 * when columns are out of view), a long name is cut with an ellipsis (its full text is the tooltip), never in the middle of a word on two lines. The state is the chip of the Agents page (same words, same colours); the harness is a
 * neutral chip (its version is information, not a verdict: a colour would make 2.1.322 look wrong).
 *
 * @registryCategory composite
 * @registryTags sessions table
 */
export function SessionsTable({ rows, hiddenText, emptyText }: SessionsTableProps) {
  return (
    <Scope>
      {/* pt-4 = the space-y-4 of PageContent: the host wrapper of a custom component does not get that margin. */}
      <div className="flex min-w-0 flex-col gap-2 pt-4">
        {hiddenText === undefined || hiddenText === '' ? null : <p className="text-sm text-muted">{hiddenText}</p>}
        {rows === undefined ? (
          <div role="status" aria-busy="true" className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
            Loading the sessions...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">{emptyText === undefined || emptyText === '' ? 'No session to show' : emptyText}</div>
        ) : (
          <div className="min-w-0 rounded-lg border border-border bg-surface">
            <ScrollTable label="Agents table">
              <thead>
                <tr className="border-b border-border">
                  <th className={TH}>Session</th>
                  <th className={TH}>Folder</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Detail</th>
                  <th className={TH}>Status since</th>
                  <th className={TH}>PID</th>
                  <th className={TH}>Harness</th>
                  <th className={TH}>Alive</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  return (
                    <tr key={row.sessionId} className="border-b border-border last:border-b-0">
                      <td className={`${TD} max-w-52 truncate font-medium`} title={`${row.displayName} (${row.sessionId})`}>
                        <a href={`${PAGE_BASE}/agents?session=${encodeURIComponent(row.sessionId)}`} className="text-primary underline">
                          {row.displayName}
                        </a>
                      </td>
                      <td className={`${TD} max-w-36 truncate`} title={row.cwd}>
                        {row.folder}
                      </td>
                      <td className={`${TD} whitespace-nowrap`} title={STATE_MEANING[row.state]}>
                        <StateChip state={row.state} />
                      </td>
                      <td className={`${TD} max-w-64 truncate text-muted`} title={detailOf(row)}>
                        {detailOf(row)}
                      </td>
                      <td className={`${TD} whitespace-nowrap tabular-nums`}>
                        {row.statusUpdatedAt === undefined ? '' : clockText(row.statusUpdatedAt)}
                      </td>
                      <td className={`${TD} whitespace-nowrap ${MONO}`}>{row.pid}</td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <Chip data-harness-chip="" variant="neutral">
                          {row.harness}
                        </Chip>
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <Badge label={row.alive ? 'alive' : 'dead'} variant={row.alive ? 'success' : 'danger'} tone="subtle" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </ScrollTable>
          </div>
        )}
      </div>
    </Scope>
  );
}
