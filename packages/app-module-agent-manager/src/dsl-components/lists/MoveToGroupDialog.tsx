import { ButtonAction, FieldText, HorizontalStack } from '@wadeck-app/dsl-ui';
import { Check, FolderPlus, FolderX } from 'lucide-react';
import { useState } from 'react';
import type { AgentRow } from '../data/types.js';
import { checkGroupName } from '../shared.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { Modal } from '../ui/Modal.js';
import type { GroupsApi } from './common.js';
import { GroupDot } from './GroupDot.js';

const OPTION = `flex min-h-am-hit w-full items-center gap-2 rounded border border-border px-3 py-1.5 text-left text-sm text-content hover:bg-muted-bg disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`;

/**
 * The keyboard (and pointer) alternative to dragging an agent: a list of the groups, a way out of the current one, and a field to make a new group and
 * move there at once. Choosing closes the dialog; the change shows at once in the list.
 */
export function MoveToGroupDialog({ session, groups, onClose }: { session: AgentRow; groups: GroupsApi; onClose: () => void }) {
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const current = session.customGroupId;
  const id = session.sessionId.toLowerCase();

  const choose = (groupId: string | null): void => {
    groups.move(id, groupId, null);
    onClose();
  };
  const createAndMove = async (): Promise<void> => {
    const checked = checkGroupName(name);
    if (!checked.ok) {
      setProblem(checked.text);
      return;
    }
    setProblem('');
    setBusy(true);
    const created = await groups.create(checked.name);
    setBusy(false);
    if (created === undefined) {
      // The page shows why the server refused (a banner); the dialog stays so the name can be corrected.
      setProblem('The group was not created: see the message at the top of the page.');
      return;
    }
    choose(created.id);
  };

  let autofocusGiven = false;
  const autofocus = (disabled: boolean): { 'data-autofocus'?: string } => {
    if (disabled || autofocusGiven) {
      return {};
    }
    autofocusGiven = true;
    return { 'data-autofocus': '' };
  };

  return (
    <Modal title={`Move ${session.displayName} to a group`} size="narrow" onClose={onClose}>
      <div className="flex flex-col gap-2">
        {groups.groups.map((group) => {
          const here = group.id === current;
          return (
            <button key={group.id} type="button" disabled={here} aria-current={here ? 'true' : undefined} onClick={() => choose(group.id)} className={OPTION} {...autofocus(here)}>
              <GroupDot color={group.color} />
              <span className="min-w-0 flex-1 truncate">{group.name}</span>
              {here ? (
                <>
                  <Check aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
                  <span className="text-xs text-muted">Current group</span>
                </>
              ) : null}
            </button>
          );
        })}
        <button type="button" disabled={current === null} onClick={() => choose(null)} className={OPTION} {...autofocus(current === null)}>
          <FolderX aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
          <span className="flex-1">{current === null ? 'Ungrouped (current)' : 'Ungrouped: take it out of its group'}</span>
        </button>
        <form
          className="mt-2 flex flex-col gap-1.5 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void createAndMove();
          }}
        >
          {/* The base field and the base button share one height (38 px); items-end puts the button on the bottom of the input, whose label is above it, and the row wraps whole on a narrow screen. */}
          <HorizontalStack gap="gap-2" align="items-end" wrap>
            <div className="min-w-[12rem] flex-1">
              <FieldText label="New group" value={name} onChange={setName} maxLength={80} placeholder="Name of the group" />
            </div>
            <ButtonAction variant="primary" type="submit" loading={busy} icon={<FolderPlus aria-hidden="true" className="h-4 w-4" />} label="Create and move" />
          </HorizontalStack>
          {problem !== '' ? (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          ) : null}
        </form>
      </div>
    </Modal>
  );
}
