import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { Eye, FolderInput, MessageSquarePlus, Pin, PinOff, ShieldPlus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { AgentRow } from '../data/types.js';
import type { GroupsApi } from '../lists/common.js';
import { useSelection } from '../lists/selection.js';
import { selectedText } from '../logic/selection.js';
import { BatchAct } from './BatchAct.js';
import { BatchMoveDialog } from './BatchMoveDialog.js';
import { BatchSendDialog } from './BatchSendDialog.js';

/** Adding or removing a bypass for a whole selection is a separate piece of work (not built): the button says so and where one session can be done. */
const BATCH_BYPASS_OFF = 'Not available for a selection yet. Open one session and use Add bypass in its Permissions tab.';

export interface BatchBarProps {
  /** The selected sessions that the page still has, in the order of the list. */
  rows: readonly AgentRow[];
  /** The custom groups API of the page; the Move button is off where there is none. */
  groups: GroupsApi | undefined;
  onPin: (rows: readonly AgentRow[], pinned: boolean) => void;
  onSeen: (rows: readonly AgentRow[]) => void;
}

/**
 * The bar that appears above the list while at least one session is selected: how many, and what can be done to all of them. Sending a message and moving
 * open a dialog; pinning and marking as seen act at once. Add / remove bypass is drawn off with the reason (the batch version is not built; one session has Add bypass in its Permissions tab).
 */
export function BatchBar({ rows, groups, onPin, onSeen }: BatchBarProps) {
  const selection = useSelection();
  const [dialog, setDialog] = useState<'send' | 'move' | undefined>(undefined);
  if (selection === null || selection.count === 0) {
    return null;
  }
  const allPinned = rows.length > 0 && rows.every((row) => row.pinned);
  const unseen = rows.filter((row) => row.state === 'done');
  const icon = 'h-4 w-4';
  return (
    <div data-batch-bar="" role="toolbar" aria-label="Actions on the selected sessions" className="sticky top-0 z-20 flex flex-wrap items-center gap-1.5 border-b border-border bg-primary-light px-2 py-1.5">
      <span role="status" aria-live="polite" className="mr-1 text-sm font-medium text-content">
        {selectedText(selection.count)}
      </span>
      <ButtonAction variant="primary" size="sm" icon={<MessageSquarePlus aria-hidden="true" className="h-3.5 w-3.5" />} label="Send a message..." onClick={() => setDialog('send')} />
      <span role="group" aria-label="More actions" className="flex items-center gap-0.5">
        <BatchAct label="Mark as seen" icon={<Eye aria-hidden="true" className={icon} />} {...(unseen.length > 0 ? { onClick: () => onSeen(unseen) } : { off: 'None of the selected sessions has finished without being seen: there is nothing to mark.' })} />
        <BatchAct
          label={allPinned ? 'Unpin' : 'Pin'}
          icon={allPinned ? <PinOff aria-hidden="true" className={icon} /> : <Pin aria-hidden="true" className={icon} />}
          onClick={() => onPin(allPinned ? rows : rows.filter((row) => !row.pinned), !allPinned)}
        />
        <BatchAct label="Move to group" icon={<FolderInput aria-hidden="true" className={icon} />} {...(groups === undefined ? { off: 'The groups are not available on this page: reload it.' } : { onClick: () => setDialog('move') })} />
        <BatchAct label="Add / remove bypass" icon={<ShieldPlus aria-hidden="true" className={icon} />} off={BATCH_BYPASS_OFF} />
      </span>
      <span className="ml-auto">
        <IconButton size="icon-sm" aria-label="Clear the selection (Escape)" onClick={selection.clear} icon={<X aria-hidden="true" className={icon} />} />
      </span>
      {dialog === 'send' ? <BatchSendDialog rows={rows} onClose={() => setDialog(undefined)} /> : null}
      {dialog === 'move' && groups !== undefined ? <BatchMoveDialog rows={rows} groups={groups} onClose={() => setDialog(undefined)} onMoved={selection.clear} /> : null}
    </div>
  );
}
