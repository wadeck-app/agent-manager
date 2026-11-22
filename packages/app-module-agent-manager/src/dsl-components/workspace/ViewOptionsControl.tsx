import { SlidersHorizontal } from 'lucide-react';
import { MODE_LABEL, type ModeId } from '../shared.js';
import type { TreeExpansion, TreeGrouping, ViewOptions } from '../logic/viewOptions.js';
import { IconButton } from '@wadeck-app/dsl-ui';
import { Tooltip } from '../ui/Tooltip.js';
import { usePopover } from '../ui/usePopover.js';
import { OptionChoice } from './OptionChoice.js';
import { OptionGroup } from './OptionGroup.js';
import { OptionToggle } from './OptionToggle.js';

export interface ViewOptionsControlProps {
  mode: ModeId;
  options: ViewOptions;
  onChange: (next: ViewOptions) => void;
}

/**
 * The "View options" button of the toolbar and its panel: the options of the CURRENT mode (remembered per mode). Tree: grouping and expansion. Groups: the last
 * activity line. Inbox: auto-next (off by default: it can be disturbing, so it says what it does).
 */
export function ViewOptionsControl({ mode, options, onChange }: ViewOptionsControlProps) {
  const { open, setOpen, box, panelId } = usePopover('input:checked, input[type="checkbox"]');
  const tree = options.tree;
  const setTree = (patch: Partial<{ grouping: TreeGrouping; expansion: TreeExpansion }>): void => onChange({ ...options, tree: { ...tree, ...patch } });
  return (
    <div ref={box} className="relative">
      <IconButton variant={open ? 'neutral' : 'ghost'} aria-label="View options" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)} icon={<SlidersHorizontal aria-hidden="true" className="h-4 w-4" />} />
      {open ? (
        <div id={panelId} role="dialog" aria-label={`View options, ${MODE_LABEL[mode]}`} className="absolute right-0 top-full z-30 mt-1 flex w-80 flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <p className="text-sm font-medium text-content">View options: {MODE_LABEL[mode]}</p>
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
          {mode === 'groups' ? (
            <OptionToggle checked={options.groups.preview} onToggle={(preview) => onChange({ ...options, groups: { preview } })} label="Show the last activity" hint="A second line with why it needs you or what it did last" />
          ) : null}
          {mode === 'inbox' ? (
            <OptionToggle checked={options.inbox.autoNext} onToggle={(autoNext) => onChange({ ...options, inbox: { autoNext } })} label="Open the next agent after a reply" hint="When the agent you are on stops needing you, the next one that does opens by itself" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
