import type { ReactNode } from 'react';
import type { GrantRowData } from './grantModel.js';

/** The `<li>` of a row: the marker the tests read (data-cli-grant when the admin CLI listed it, data-grant for the plugin files), and the confirmation under the row. */
export function GrantShell({ grant, className, children, confirmBox }: { grant: GrantRowData; className: string; children: ReactNode; confirmBox: ReactNode }) {
  const marker = grant.cli === undefined ? { 'data-grant': grant.id } : { 'data-cli-grant': grant.id };
  return (
    <li {...marker} data-grant-row="" className={className}>
      {children}
      {confirmBox}
    </li>
  );
}
