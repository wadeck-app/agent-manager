import type { CliGrantDto } from '../deps.js';
import type { GrantRowData } from './grantModel.js';
import { TableRow } from './TableRow.js';

/** Nothing can be revoked from here (the bypasses of the other sessions, or of this one read from the plugin files): the rows then show no trash icon. */
const NOT_REVOCABLE = async (): Promise<boolean> => false;

/** The rows of one section: one table line per bypass. */
export function GrantRows({ grants, now, busy, onRevoke = NOT_REVOCABLE }: { grants: readonly GrantRowData[]; now: number; busy: boolean; onRevoke?: (grant: CliGrantDto) => Promise<boolean> }) {
  return (
    <ul data-grant-rows="">
      {grants.map((grant) => (
        <TableRow key={`${grant.sessionId}|${grant.id}`} grant={grant} now={now} busy={busy} onRevoke={onRevoke} />
      ))}
    </ul>
  );
}
