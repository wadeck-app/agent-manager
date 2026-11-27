import type { ReactNode } from 'react';
import type { GrantGroup } from './grantModel.js';

/** The `<li>` of a row: the marker the tests read (data-cli-grant when the admin CLI listed it, data-grant for the plugin files), and the confirmation under the row. */
export function GrantShell({ group, className, children, confirmBox }: { group: GrantGroup; className: string; children: ReactNode; confirmBox: ReactNode }) {
  const first = group.grants[0]!;
  const marker = first.cli === undefined ? { 'data-grant': first.id } : { 'data-cli-grant': first.id };
  return (
    <li {...marker} data-grant-row="" className={className}>
      {children}
      {confirmBox}
    </li>
  );
}
