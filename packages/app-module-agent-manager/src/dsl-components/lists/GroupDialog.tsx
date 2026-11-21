import { ArrowDown, ArrowUp, Check, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { checkGroupName, GROUP_COLORS, type CustomGroupDto, type GroupColor } from '../shared.js';
import { stepGroupIds } from '../logic/customGroups.js';
import { GROUP_LOOK } from '../ui/groupLook.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import { Modal } from '../ui/Modal.js';
import type { GroupsApi } from './common.js';

const BUTTON = `inline-flex h-am-hit items-center gap-1.5 rounded border border-border px-3 text-sm text-content hover:bg-muted-bg disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;

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
        <div className="flex flex-col gap-1.5">
          <label htmlFor="group-name" className="text-sm font-medium text-content">
            Name
          </label>
          <input
            id="group-name"
            data-autofocus=""
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={!checked.ok}
            aria-describedby={checked.ok ? undefined : 'group-name-problem'}
            className={`h-am-hit rounded border border-border bg-surface px-2 text-sm text-content ${FOCUS_RING}`}
          />
          {!checked.ok ? (
            <p id="group-name-problem" role="alert" className="text-sm text-danger">
              {checked.text}
            </p>
          ) : null}
        </div>

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
            <button type="button" disabled={up === undefined} onClick={() => up !== undefined && groups.reorder(up)} className={BUTTON}>
              <ArrowUp aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
              Move up
            </button>
            <button type="button" disabled={down === undefined} onClick={() => down !== undefined && groups.reorder(down)} className={BUTTON}>
              <ArrowDown aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
              Move down
            </button>
          </div>
        </div>

        {confirming ? (
          <div role="alert" className="flex flex-col gap-2 rounded border border-danger p-3 text-sm text-content">
            <p>
              {memberCount === 0 ? 'Delete this empty group?' : `Delete this group? Its ${memberCount} ${memberCount === 1 ? 'agent becomes' : 'agents become'} ungrouped; no agent is stopped.`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  groups.remove(group.id);
                  onClose();
                }}
                className={`inline-flex h-am-hit items-center gap-1.5 rounded border border-danger px-3 text-sm font-medium text-danger hover:bg-muted-bg ${FOCUS_RING}`}
              >
                <Trash2 aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
                Delete the group
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={BUTTON}>
                Keep it
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2 border-t border-border pt-3">
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)} className={`${BUTTON} text-danger`}>
              <Trash2 aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
              Delete group
            </button>
          ) : null}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className={BUTTON}>
            Cancel
          </button>
          <button type="submit" disabled={!checked.ok} className={`inline-flex h-am-hit items-center rounded border border-primary bg-primary-light px-3 text-sm font-medium text-primary disabled:opacity-50 ${FOCUS_RING}`}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
