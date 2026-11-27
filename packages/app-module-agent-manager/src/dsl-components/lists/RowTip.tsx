import { Tooltip } from '@wadeck-app/dsl-ui';
import type { ReactElement } from 'react';
import type { AgentRow } from '../data/types.js';
import { TIP_FILL, TIP_FIT } from '../ui/tipWrap.js';

/**
 * The tooltip of the name of an agent in a list row: the full name (the row cuts it with an ellipsis), the folder it runs in (full path, which breaks anywhere) and, when the row has one,
 * what it is doing (4 lines at most). The card is the `rows` of the dsl-ui Tooltip (a long word breaks anywhere, the activity is clamped to 4 lines), 384 px wide at most.
 */
export function RowTip({ session, line = '', fit = false, children }: { session: AgentRow; line?: string; /** The trigger truncates (a name) instead of filling its container. */ fit?: boolean; children: ReactElement }) {
  const rows = [
    { label: 'Name', value: session.displayName },
    { label: 'Folder', value: session.cwd },
    ...(line === '' ? [] : [{ label: 'Activity', value: line, clamp: 4 as const }]),
  ];
  return (
    <Tooltip side="top" className={fit ? TIP_FIT : TIP_FILL} rows={rows} maxWidth="sm" describe={false}>
      {children}
    </Tooltip>
  );
}
