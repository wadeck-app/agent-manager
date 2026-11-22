import { KeyRound } from 'lucide-react';
import { folderName } from '../logic/folderPicker.js';
import { clockText, remainingText } from '../logic/guardrails.js';
import type { GrantDto } from '../shared.js';
import { Tooltip } from '../ui/Tooltip.js';
import { Empty } from './Empty.js';
import { TD, TH } from './parts.js';
import { Section } from './Section.js';
import { ScrollTable } from '../ui/ScrollTable.js';
import { SessionCell } from './SessionCell.js';

/** The bypasses the hook honours now: category, mode, time left, session, project, the reason the agent gave, uses. */
export function GrantsSection({ grants, hiddenEntries, now, scanned }: { grants: readonly GrantDto[]; hiddenEntries: number; now: number; scanned: number }) {
  return (
    <Section id="guardrails-grants" icon={KeyRound} title="Active bypasses" count={grants.length}>
      {grants.length === 0 ? (
        <Empty title="No active bypass" hint={`${scanned} project folder(s) scanned.${hiddenEntries > 0 ? ` ${hiddenEntries} entr${hiddenEntries === 1 ? 'y is' : 'ies are'} left out because the hook ignores them (expired, used up, or expiring more than 24 h ahead).` : ''}`} />
      ) : (
        <>
          <ScrollTable label="Active bypasses">
            <thead>
              <tr className="border-b border-border">
                <th className={TH}>Category</th>
                <th className={TH}>Mode</th>
                <th className={TH}>Time left</th>
                <th className={TH}>Session</th>
                <th className={TH}>Project</th>
                <th className={TH}>Reason given</th>
                <th className={TH}>Uses</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => {
                const left = Math.max(0, grant.expiresAt - now);
                return (
                  <tr key={`${grant.project}|${grant.id}`} className="border-b border-border last:border-b-0">
                    <td className={`${TD} font-medium`}>{grant.category}</td>
                    <td className={TD}>{grant.mode === 'once' ? 'Once' : 'Time-boxed'}</td>
                    <td className={`${TD} tabular-nums`}>
                      <Tooltip content={`Expires at ${clockText(grant.expiresAt)}`}>
                        <span>{remainingText(left)}</span>
                      </Tooltip>
                    </td>
                    <td className={TD}>
                      <SessionCell sessionId={grant.sessionId} name={grant.sessionName} />
                    </td>
                    <td className={TD}>
                      <span title={grant.project}>{folderName(grant.project)}</span>
                    </td>
                    <td className={`${TD} max-w-xl break-words`}>{grant.rationale === '' ? <span className="text-muted">none given</span> : grant.rationale}</td>
                    <td className={`${TD} tabular-nums`}>{grant.maxUses === null ? `${grant.used}` : `${grant.used} of ${grant.maxUses}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </ScrollTable>
          {hiddenEntries > 0 ? <p className="border-t border-border px-3 py-2 text-xs text-muted">{hiddenEntries} more entr{hiddenEntries === 1 ? 'y is' : 'ies are'} left out because the hook ignores them (expired, used up, or expiring more than 24 h ahead).</p> : null}
        </>
      )}
    </Section>
  );
}
