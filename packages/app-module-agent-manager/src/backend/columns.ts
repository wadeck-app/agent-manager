import { harnessBadges, type SessionRow } from './present.js';
import type { DslNode } from './dslNode.js';

/**
 * The columns of the sessions table. They are built by the route, not written in the view, because the badge map of the Harness column
 * (cell text -> variant) depends on the versions found on this machine: the most recent one is green, an older one is orange.
 */
export function sessionColumns(rows: readonly SessionRow[]): DslNode[] {
  return [
    // Session, Folder and Detail wrap: a long name with nowrap pushed the Status and the columns after it out of the table (clipped, no scrollbar).
    { key: 'displayName', label: 'Session', title: '{sessionId}' },
    { key: 'folder', label: 'Folder', title: '{cwd}' },
    { key: 'statusGroup', label: 'Status', nowrap: true, badge: { busy: 'info', idle: 'success', other: 'warning' } },
    { key: 'statusDetail', label: 'Detail', muted: true },
    { key: 'statusUpdatedAt', label: 'Status since', format: 'datetime', nowrap: true },
    { key: 'pid', label: 'PID', mono: true, nowrap: true },
    { key: 'harness', label: 'Harness', nowrap: true, badge: harnessBadges(rows) },
    { key: 'aliveText', label: 'Alive', nowrap: true, badge: { alive: 'success', dead: 'danger' } },
  ];
}
