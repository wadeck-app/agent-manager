import type { ReactNode } from 'react';
import type { AgentRow } from '../data/types.js';
import type { GroupsApi } from '../lists/common.js';
import { useSelection } from '../lists/selection.js';
import { agentId } from '../logic/states.js';
import { BatchBar } from './BatchBar.js';

export interface SelectedBarProps {
  /** Every row of the page, in the order of the list. */
  rows: readonly AgentRow[];
  groups: GroupsApi | undefined;
  onPin: (rows: readonly AgentRow[], pinned: boolean) => void;
  onSeen: (rows: readonly AgentRow[]) => void;
  children?: ReactNode;
}

/** The batch bar for the rows that are selected (in the order of `rows`); nothing while the selection is empty. */
export function SelectedBar({ rows, groups, onPin, onSeen }: SelectedBarProps) {
  const selection = useSelection();
  if (selection === null || selection.count === 0) {
    return null;
  }
  return <BatchBar rows={rows.filter((row) => selection.isSelected(agentId(row)))} groups={groups} onPin={onPin} onSeen={onSeen} />;
}
