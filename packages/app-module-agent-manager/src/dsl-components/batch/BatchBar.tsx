import { ButtonAction } from '@wadeck-app/dsl-ui';
import { Eye, FolderInput, MessageSquarePlus, Pin, PinOff, ShieldOff, ShieldPlus } from 'lucide-react';
import { useState } from 'react';
import type { AgentRow } from '../data/types.js';
import type { GroupsApi } from '../lists/common.js';
import { useSelection } from '../lists/selection.js';
import { BatchAct } from './BatchAct.js';
import { BatchAddBypassDialog } from './BatchAddBypassDialog.js';
import { BatchMoveDialog } from './BatchMoveDialog.js';
import { BatchPopup } from './BatchPopup.js';
import { BatchRemoveBypassDialog } from './BatchRemoveBypassDialog.js';
import { BatchSendDialog } from './BatchSendDialog.js';

export interface BatchBarProps {
  /** The selected sessions that the page still has, in the order of the list. */
  rows: readonly AgentRow[];
  /** The custom groups API of the page; the Move button is off where there is none. */
  groups: GroupsApi | undefined;
  onPin: (rows: readonly AgentRow[], pinned: boolean) => void;
  onSeen: (rows: readonly AgentRow[]) => void;
}

/**
 * The floating popup (BatchPopup: bottom centre of the content area, above the A/B dock) that appears while at least one session is selected: how many, and what can be done to all of them.
 * Sending a message, moving, and adding or removing bypasses (PIN-gated, threat-model T-24) open a dialog (rendered beside the popup, never inside its toolbar); pinning and marking as seen act at once.
 */
export function BatchBar({ rows, groups, onPin, onSeen }: BatchBarProps) {
  const selection = useSelection();
  const [dialog, setDialog] = useState<'send' | 'move' | 'add-bypass' | 'remove-bypass' | undefined>(undefined);
  if (selection === null || selection.count === 0) {
    return null;
  }
  const allPinned = rows.length > 0 && rows.every((row) => row.pinned);
  const unseen = rows.filter((row) => row.state === 'done');
  const icon = 'h-4 w-4';
  return (
    <>
      <BatchPopup count={selection.count} onClear={selection.clear}>
        <ButtonAction variant="primary" size="sm" icon={<MessageSquarePlus aria-hidden="true" className="h-3.5 w-3.5" />} label="Send a message..." onClick={() => setDialog('send')} />
        <span role="group" aria-label="More actions" className="flex items-center gap-0.5">
          <BatchAct label="Mark as seen" icon={<Eye aria-hidden="true" className={icon} />} {...(unseen.length > 0 ? { onClick: () => onSeen(unseen) } : { off: 'None of the selected sessions has finished without being seen: there is nothing to mark.' })} />
          <BatchAct
            label={allPinned ? 'Unpin' : 'Pin'}
            icon={allPinned ? <PinOff aria-hidden="true" className={icon} /> : <Pin aria-hidden="true" className={icon} />}
            onClick={() => onPin(allPinned ? rows : rows.filter((row) => !row.pinned), !allPinned)}
          />
          <BatchAct label="Move to group" icon={<FolderInput aria-hidden="true" className={icon} />} {...(groups === undefined ? { off: 'The groups are not available on this page: reload it.' } : { onClick: () => setDialog('move') })} />
          <BatchAct label="Add bypass" icon={<ShieldPlus aria-hidden="true" className={icon} />} onClick={() => setDialog('add-bypass')} />
          <BatchAct label="Remove bypass" icon={<ShieldOff aria-hidden="true" className={icon} />} onClick={() => setDialog('remove-bypass')} />
        </span>
      </BatchPopup>
      {dialog === 'send' ? <BatchSendDialog rows={rows} onClose={() => setDialog(undefined)} /> : null}
      {dialog === 'add-bypass' ? <BatchAddBypassDialog rows={rows} onClose={() => setDialog(undefined)} /> : null}
      {dialog === 'remove-bypass' ? <BatchRemoveBypassDialog rows={rows} onClose={() => setDialog(undefined)} /> : null}
      {dialog === 'move' && groups !== undefined ? <BatchMoveDialog rows={rows} groups={groups} onClose={() => setDialog(undefined)} onMoved={selection.clear} /> : null}
    </>
  );
}
