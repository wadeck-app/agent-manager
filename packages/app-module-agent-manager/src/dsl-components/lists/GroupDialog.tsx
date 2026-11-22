import { ButtonAction, FieldText } from '@wadeck-app/dsl-ui';
import { ArrowDown, ArrowUp, Check, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { checkGroupName, GROUP_COLORS, type CustomGroupDto, type GroupColor } from '../shared.js';
import { stepGroupIds } from '../logic/customGroups.js';
import { GROUP_LOOK } from '../ui/groupLook.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { DialogActions } from '../ui/DialogActions.js';
import { Modal } from '../ui/Modal.js';
import type { GroupsApi } from './common.js';

/**
 * The actions of a group, all reachable with the keyboard: rename, color, move up or down among the groups, delete (two steps: it says what happens to the
 * agents first). Save applies the name and the color; the move buttons and the delete act at once.
 */
export function GroupDialog({ group, memberCount, groups, onClose }: { group: CustomGroupDto; memberCount: number; groups: GroupsApi; onClose: () => void }) {
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState<GroupColor | null>(group.color);
  const [confirming, setConfirming] = useState(false);
  const checked = checkGroupName(name);
  const position = groups.groups.findIndex((candidate) => candidate.id === group.id);
  const up = stepGroupIds(groups.groups, group.id, -1);
  const down = stepGroupIds(groups.groups, group.id, 1);

  const save = (): void => {
    if (!checked.ok) {
      return;
    }
    const patch: { name?: string; color?: GroupColor | null } = {};
    if (checked.name !== group.name) {
      patch.name = checked.name;
    }
    if (color !== group.color) {
      patch.color = color;
    }
    if (Object.keys(patch).length > 0) {
      groups.update(group.id, patch);
    }
    onClose();
  };

  return (
    <Modal title={`Group ${group.name}`} size="narrow" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <FieldText label="Name" data-autofocus="" value={name} onChange={setName} error={checked.ok ? undefined : checked.text} />

        <div className="flex flex-col gap-1.5">
          <span id="group-color-label" className="text-sm font-medium text-content">
            Color
          </span>
          <div role="radiogroup" aria-labelledby="group-color-label" className="flex flex-wrap gap-1.5">
            {([null, ...GROUP_COLORS] as (GroupColor | null)[]).map((option) => {
              const look = GROUP_LOOK[option ?? 'none'];
              const selected = option === color;
              return (
                <button key={option ?? 'none'} type="button" role="radio" aria-checked={selected} onClick={() => setColor(option)} className={`inline-flex h-am-hit items-center gap-1.5 rounded border px-2 text-sm text-content ${selected ? 'border-primary bg-primary-light' : 'border-border hover:bg-muted-bg'} ${FOCUS_RING}`}>
                  <span aria-hidden="true" className={`inline-block h-am-dot w-am-dot rounded-full ${look.dot}`} />
                  {look.label}
                  {selected ? <Check aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" /> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-content">
            Position: {position + 1} of {groups.groups.length}
          </span>
          <div className="flex gap-2">
            <ButtonAction variant="secondary" size="sm" disabled={up === undefined} onClick={() => up !== undefined && groups.reorder(up)} icon={<ArrowUp aria-hidden="true" className="h-4 w-4" />} label="Move up" />
            <ButtonAction variant="secondary" size="sm" disabled={down === undefined} onClick={() => down !== undefined && groups.reorder(down)} icon={<ArrowDown aria-hidden="true" className="h-4 w-4" />} label="Move down" />
          </div>
        </div>

        {confirming ? (
          <div role="alert" className="flex flex-col gap-2 rounded border border-danger p-3 text-sm text-content">
            <p>
              {memberCount === 0 ? 'Delete this empty group?' : `Delete this group? Its ${memberCount} ${memberCount === 1 ? 'agent becomes' : 'agents become'} ungrouped; no agent is stopped.`}
            </p>
            <div className="flex gap-2">
              <ButtonAction
                variant="danger"
                size="sm"
                icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                label="Delete the group"
                onClick={() => {
                  groups.remove(group.id);
                  onClose();
                }}
              />
              <ButtonAction variant="secondary" size="sm" label="Keep it" onClick={() => setConfirming(false)} />
            </div>
          </div>
        ) : null}

        <DialogActions>
          {!confirming ? <ButtonAction variant="danger-outline" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />} label="Delete group" onClick={() => setConfirming(true)} /> : null}
          <span className="flex-1" />
          <ButtonAction variant="secondary" label="Cancel" onClick={onClose} />
          <ButtonAction variant="primary" type="submit" label="Save" disabled={!checked.ok} />
        </DialogActions>
      </form>
    </Modal>
  );
}
