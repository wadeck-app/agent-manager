import { Tooltip } from '@wadeck-app/dsl-ui';
import type { ReactElement } from 'react';
import type { AgentRow } from '../data/types.js';
import { PathText } from '../ui/PathText.js';

/**
 * The tooltip of the name of an agent in a list row: the full name (the row cuts it with an ellipsis), the folder it runs in (full path, which breaks anywhere) and, when the row has one,
 * what it is doing. The wrapper of the dsl-ui Tooltip takes its size from the trigger's `data-tip-fill` or `data-tip-fit` (styles/agents.css).
 */
export function RowTip({ session, line = '', children }: { session: AgentRow; line?: string; children: ReactElement }) {
  const rows = [
    { label: 'Name', value: session.displayName },
    { label: 'Folder', value: <PathText text={session.cwd} /> },
    ...(line === '' ? [] : [{ label: 'Activity', value: line }]),
  ];
  return (
    <Tooltip side="top" rows={rows} describe={false}>
      {children}
    </Tooltip>
  );
}
