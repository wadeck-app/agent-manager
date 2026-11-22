import { ShieldAlert } from 'lucide-react';
import { CopyButton } from '../detail/log/CopyButton.js';
import { folderName } from '../logic/folderPicker.js';
import { bypassCommand, remainingText } from '../logic/guardrails.js';
import type { SessionBlocksDto } from '../shared.js';
import { Empty } from './Empty.js';
import { TD, TH } from './parts.js';
import { Section } from './Section.js';
import { ScrollTable } from '../ui/ScrollTable.js';
import { SessionCell } from './SessionCell.js';

/** The counters of the plugin per session: blocked N times on [category], refused requests and a timeout. A "copy command" gives the text to run in that session. */
export function BlockedSessionsSection({ sessions, now }: { sessions: readonly SessionBlocksDto[]; now: number }) {
  return (
    <Section id="guardrails-blocked" icon={ShieldAlert} title="Blocked sessions" count={sessions.length}>
      {sessions.length === 0 ? (
        <Empty title="No session has been blocked" hint="Counters come from the plugin state of each scanned project. They count only the denials that carry a bypass hint; the timeline below counts every denial." />
      ) : (
        <ScrollTable label="Blocked sessions">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Session</th>
              <th className={TH}>Project</th>
              <th className={TH}>Blocked in total</th>
              <th className={TH}>Bypass requests</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((item) => (
              <tr key={`${item.project}|${item.sessionId}`} className="border-b border-border last:border-b-0">
                <td className={TD}>
                  <SessionCell sessionId={item.sessionId} name={item.sessionName} />
                </td>
                <td className={TD}>
                  <span title={item.project}>{folderName(item.project)}</span>
                </td>
                <td className={TD}>
                  {item.total === 0 ? (
                    <span className="text-muted">none</span>
                  ) : (
                    <ul aria-label="Categories" className="flex flex-col gap-0.5">
                      {item.blocks.map((block) => (
                        <li key={block.category} className="flex items-center gap-1">
                          <span className="tabular-nums font-medium">{block.count}</span>
                          <span>on {block.category}</span>
                          <CopyButton text={bypassCommand(block.category)} label={`Copy ${bypassCommand(block.category)} (run it in that session yourself)`} />
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className={TD}>
                  {item.timeoutUntil !== null ? (
                    <span className="text-warning-text">Timed out for {remainingText(item.timeoutUntil - now)} after {item.refusedCount} refused requests</span>
                  ) : item.refusedCount > 0 ? (
                    <span>{item.refusedCount} refused (3 start a 30 min timeout)</span>
                  ) : (
                    <span className="text-muted">none refused</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </Section>
  );
}
