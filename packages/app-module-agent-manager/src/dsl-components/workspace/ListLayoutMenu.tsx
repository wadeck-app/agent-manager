import { IconButton } from '@wadeck-app/dsl-ui';
import { Check, FolderKanban, Inbox, LayoutList, LayoutPanelLeft, ListTree, type LucideIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { MODE_LABEL, MODES, type ModeId } from '../shared.js';
import type { TreeExpansion, TreeGrouping, ViewOptions } from '../logic/viewOptions.js';
import { POPUP_SECTION, POPUP_SURFACE } from '../ui/popupSurface.js';
import { usePopover } from '../ui/usePopover.js';
import { OptionChoice } from './OptionChoice.js';
import { OptionGroup } from './OptionGroup.js';
import { OptionToggle } from './OptionToggle.js';
import { RowButton } from '../ui/RowButton.js';

const MODE_ICON: Record<ModeId, LucideIcon> = { tree: ListTree, groups: LayoutList, inbox: Inbox, custom: FolderKanban };

const MODE_HINT: Record<ModeId, string> = {
  tree: 'Agents under their working directory, sub-agents nested',
  groups: 'Agents by state: Needs you, Done, Working, Idle',
  inbox: 'What needs you first, in tabs',
  custom: 'Every agent inside your own groups (Herdr style), ungrouped ones last',
};

const CHECKED_ITEM = '[role="radio"][aria-checked="true"]';

export interface ListLayoutMenuProps {
  mode: ModeId;
  onMode: (mode: ModeId) => void;
  options: ViewOptions;
  onOptions: (next: ViewOptions) => void;
}

/**
 * The ONE configuration control of the list, behind ONE fixed icon (it never changes with the mode: the current layout is the checked item inside). The popup has
 * two sections, with a divider and a title each: "Layout" (how to list the agents: Tree, Groups, Inbox, Custom) and "View" (the options of that layout, remembered
 * per layout). Layout: the focus enters on the current one; arrows, Home and End move it, Enter or Space picks and closes, Escape closes with the focus back on the
 * button. The mode is in the URL (?mode=) and remembered, see logic/mode.ts. View: Tree has grouping and expansion, Tree and Custom the sub-agents, Groups the
 * last activity line, Inbox auto-next (off by default: it can be disturbing, so it says what it does). The text size and the shortcuts are not list options:
 * they keep their own buttons in the toolbar.
 */
export function ListLayoutMenu({ mode, onMode, options, onOptions }: ListLayoutMenuProps) {
  const { open, setOpen, box, panelId } = usePopover(CHECKED_ITEM);
  const tree = options.tree;
  const setTree = (patch: Partial<{ grouping: TreeGrouping; expansion: TreeExpansion }>): void => onOptions({ ...options, tree: { ...tree, ...patch } });

  const pick = (next: ModeId): void => {
    onMode(next);
    setOpen(false);
  };
  const onItemKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: ModeId): void => {
    const index = MODES.indexOf(id);
    const target =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? MODES[(index + 1) % MODES.length]
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? MODES[(index - 1 + MODES.length) % MODES.length]
          : event.key === 'Home'
            ? MODES[0]
            : event.key === 'End'
              ? MODES[MODES.length - 1]
              : undefined;
    if (target !== undefined) {
      event.preventDefault();
      box.current?.querySelector<HTMLElement>(`#agents-mode-${target}`)?.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(id);
      return;
    }
    // Tab leaves the layout list for the options below: the popup stays open (it holds controls after the list).
  };

  return (
    <div ref={box} className="relative shrink-0">
      <IconButton
        size="icon-sm"
        variant={open ? 'neutral' : 'ghost'}
        aria-label="List layout and view options"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        icon={<LayoutPanelLeft aria-hidden="true" className="h-4 w-4" />}
      />
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="List layout and view options"
          // Narrow screens: spans the window below the button; from sm: hangs from the left edge of the button.
          className={`fixed inset-x-2 z-30 mt-1 flex max-h-[calc(100vh-12rem)] flex-col overflow-y-auto ${POPUP_SURFACE} p-1 sm:absolute sm:inset-x-auto sm:left-0 sm:w-80 sm:max-w-[calc(100vw-1rem)]`}
        >
          <p data-section-title="" className="px-2 pb-1 pt-1.5 text-xs font-semibold text-muted">
            Layout
          </p>
          <div role="radiogroup" aria-label="Layout" className="flex flex-col gap-0.5">
            {MODES.map((id) => {
              const Icon = MODE_ICON[id];
              const active = id === mode;
              return (
                <RowButton
                  key={id}
                  id={`agents-mode-${id}`}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => pick(id)}
                  onKeyDown={(event) => onItemKeyDown(event, id)}
                  className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted-bg ${active ? 'bg-muted-bg' : ''}`}
                >
                  <Icon aria-hidden="true" className="mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span data-mode-name="" className={`block ${active ? 'font-medium' : ''} text-content`}>
                      {MODE_LABEL[id]}
                    </span>
                    <span data-mode-hint="" className="block text-xs text-muted-tint">
                      {MODE_HINT[id]}
                    </span>
                  </span>
                  {active ? <Check aria-hidden="true" className="mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0 text-primary" /> : null}
                </RowButton>
              );
            })}
          </div>
          <div data-section="view" className={`mt-1.5 flex flex-col gap-2 ${POPUP_SECTION} pt-1`}>
            <p data-section-title="" className="px-2 pb-0 pt-1.5 text-xs font-semibold text-muted">
              View
            </p>
            <p className="px-2 text-xs text-muted">Options of the {MODE_LABEL[mode]} layout</p>
            {mode === 'tree' ? (
              <>
                <OptionGroup label="Grouping">
                  <OptionChoice name="tree-grouping" checked={tree.grouping === 'workspace'} onSelect={() => setTree({ grouping: 'workspace' })} label="By workspace" hint="Working directories as parents" />
                  <OptionChoice name="tree-grouping" checked={tree.grouping === 'none'} onSelect={() => setTree({ grouping: 'none' })} label="None" hint="One flat list of agents, sub-agents nested" />
                </OptionGroup>
                <OptionGroup label="Expansion">
                  <OptionChoice name="tree-expansion" checked={tree.expansion === 'all'} onSelect={() => setTree({ expansion: 'all' })} label="All expanded" hint="Sub-agents load when you open an agent" />
                  <OptionChoice name="tree-expansion" checked={tree.expansion === 'attention'} onSelect={() => setTree({ expansion: 'attention' })} label="Only what needs attention" hint="Needs you, Done and unknown status stay open" />
                </OptionGroup>
              </>
            ) : null}
            {mode === 'tree' || mode === 'custom' ? (
              <OptionToggle checked={options.subagents.show} onToggle={(show) => onOptions({ ...options, subagents: { show } })} label="Show sub-agents under each agent" hint="Off: the sub-agents of an agent are listed in the right panel of the open agent (Sub-agents tab)" />
            ) : null}
            {mode === 'groups' ? (
              <OptionToggle checked={options.groups.preview} onToggle={(preview) => onOptions({ ...options, groups: { preview } })} label="Show the last activity" hint="A second line with why it needs you or what it did last" />
            ) : null}
            {mode === 'custom' ? <p className="px-2 pb-1 text-xs text-muted">The order and the colors are set per group, with the Group settings button of its header.</p> : null}
            {mode === 'inbox' ? (
              <OptionToggle checked={options.inbox.autoNext} onToggle={(autoNext) => onOptions({ ...options, inbox: { autoNext } })} label="Open the next agent after a reply" hint="When the agent you are on stops needing you, the next one that does opens by itself" />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
