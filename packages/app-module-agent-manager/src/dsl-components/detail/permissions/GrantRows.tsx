import type { CliGrantDto } from '../deps.js';
import { useUiVariant } from '../deps.js';
import { groupByReason, singles, type GrantRowData } from './grantModel.js';
import { CardRow } from './CardRow.js';
import { ExpandRow } from './ExpandRow.js';
import { GroupedRow } from './GroupedRow.js';
import { LineRow } from './LineRow.js';
import { TableRow } from './TableRow.js';

/** Nothing can be revoked from here (the bypasses of the other sessions, or of this one read from the plugin files): the rows then show no trash icon. */
const NOT_REVOCABLE = async (): Promise<boolean> => false;

/** The rows of one section, in the look the dock chose (question "Grant row"). */
export function GrantRows({ grants, now, busy, onRevoke = NOT_REVOCABLE }: { grants: readonly GrantRowData[]; now: number; busy: boolean; onRevoke?: (grant: CliGrantDto) => Promise<boolean> }) {
  const variant = useUiVariant('grantRow');
  const groups = variant === 'grouped' ? groupByReason(grants) : singles(grants);
  const Row = { line: LineRow, card: CardRow, table: TableRow, expand: ExpandRow, grouped: GroupedRow }[variant];
  return (
    <ul data-grant-rows={variant}>
      {groups.map((group) => (
        <Row key={group.key} group={group} now={now} busy={busy} onRevoke={onRevoke} />
      ))}
    </ul>
  );
}
