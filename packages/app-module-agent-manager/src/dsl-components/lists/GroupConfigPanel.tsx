import { ButtonAction, FieldText } from '@wadeck-app/dsl-ui';
import { StyledRadio } from '../ui/StyledRadio.js';
import { Settings2 } from 'lucide-react';
import { useState } from 'react';
import { checkGroupName, GROUP_SORTS, type CustomGroupDto } from '../shared.js';
import { SORT_LABEL } from '../logic/customMode.js';
import { FloatingPanel } from '../ui/FloatingPanel.js';
import type { GroupsApi } from './common.js';
import { GroupSwatches } from './GroupSwatches.js';

const SORT_OPTION = 'flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-content hover:bg-muted-bg';

/**
 * The settings of one group of the Custom mode (the folder-cog button of its header): rename, the order of its agents, the header color and the body color.
 * Every choice applies at once, like the Herdr popover; the name applies with Enter or the Rename button. The dialog of the group (position, delete) is one
 * button away.
 */
export function GroupConfigPanel({ group, anchor, groups, onClose, onMore }: { group: CustomGroupDto; anchor: { x: number; y: number }; groups: GroupsApi; onClose: () => void; onMore: () => void }) {
  const [name, setName] = useState(group.name);
  const checked = checkGroupName(name);
  const rename = (): void => {
    if (checked.ok && checked.name !== group.name) {
      groups.update(group.id, { name: checked.name });
    }
  };
  return (
    <FloatingPanel x={anchor.x} y={anchor.y} width={280} label={`Settings of the group ${group.name}`} onClose={onClose}>
      <form
        className="flex flex-col gap-3 p-1"
        onSubmit={(event) => {
          event.preventDefault();
          rename();
        }}
      >
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <FieldText label="Name" data-autofocus="" value={name} onChange={setName} error={checked.ok ? undefined : checked.text} />
          </div>
          <ButtonAction variant="secondary" size="sm" type="submit" label="Rename" disabled={!checked.ok || (checked.ok && checked.name === group.name)} />
        </div>
        <fieldset className="flex flex-col gap-0.5">
          <legend className="text-xs font-medium text-muted">Order of the agents</legend>
          {GROUP_SORTS.map((sort) => (
            <label key={sort} className={SORT_OPTION}>
              <StyledRadio name={`group-sort-${group.id}`} checked={group.sort === sort} onChange={() => groups.update(group.id, { sort })} />
              {SORT_LABEL[sort]}
            </label>
          ))}
        </fieldset>
        <GroupSwatches label="Header color" value={group.color} onPick={(color) => groups.update(group.id, { color })} />
        <GroupSwatches label="Body color" value={group.bodyColor} onPick={(bodyColor) => groups.update(group.id, { bodyColor })} />
        <ButtonAction variant="secondary" size="sm" icon={<Settings2 aria-hidden="true" className="h-3.5 w-3.5" />} label="Position, delete..." onClick={onMore} />
      </form>
    </FloatingPanel>
  );
}
