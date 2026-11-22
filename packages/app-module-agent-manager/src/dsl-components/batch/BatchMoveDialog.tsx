import { FolderX } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { agentId } from '../logic/states.js';
import type { GroupsApi } from '../lists/common.js';
import { GroupDot } from '../lists/GroupDot.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { Modal } from '../ui/Modal.js';

const OPTION = `flex min-h-am-hit w-full items-center gap-2 rounded border border-border px-3 py-1.5 text-left text-sm text-content hover:bg-muted-bg ${FOCUS_RING}`;

/**
 * Moves every selected session into one custom group (or out of its group). The page's own move is called once per session: each one shows at once and a
 * refusal of the server is said in the banner of the page, like a move by drag and drop. Not PIN-gated, like the single move (threat-model T-16).
 */
export function BatchMoveDialog({ rows, groups, onClose, onMoved }: { rows: readonly AgentRow[]; groups: GroupsApi; onClose: () => void; onMoved: () => void }) {
  const choose = (groupId: string | null): void => {
    for (const row of rows) {
      groups.move(agentId(row), groupId, null);
    }
    onMoved();
    onClose();
  };
  const sessions = rows.length === 1 ? '1 selected session' : `${rows.length} selected sessions`;
  return (
    <Modal title={`Move ${sessions} to a group`} size="narrow" onClose={onClose}>
      <div className="flex flex-col gap-2">
        {groups.groups.length === 0 ? <p className="text-sm text-muted">There is no group yet: create one with New group in the toolbar, then move the selection.</p> : null}
        {groups.groups.map((group, index) => (
          <button key={group.id} type="button" onClick={() => choose(group.id)} className={OPTION} {...(index === 0 ? { 'data-autofocus': '' } : {})}>
            <GroupDot color={group.color} />
            <span className="min-w-0 flex-1 truncate">{group.name}</span>
          </button>
        ))}
        <button type="button" onClick={() => choose(null)} className={OPTION} {...(groups.groups.length === 0 ? { 'data-autofocus': '' } : {})}>
          <FolderX aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
          <span className="flex-1">Ungrouped: take them out of their group</span>
        </button>
      </div>
    </Modal>
  );
}
