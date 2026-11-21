import { CheckCheck, ChevronDown, Ellipsis, GitFork, Pin, PinOff } from 'lucide-react';
import { ActionsMenu, type MenuItem } from './ActionsMenu.js';
import { FOCUS_RING, IconButton, Tooltip, useUiVariant } from './deps.js';

export interface HeaderActionsProps {
  /** An action of the header is running: the buttons wait. */
  busy: boolean;
  onFork: () => void;
  /** Why Fork is not possible now (shown as its tooltip and as the reason of the disabled menu item); undefined when it is. */
  forkBlocked: string | undefined;
  forkMeaning: string;
  pinned: boolean;
  onTogglePin: () => void;
  canMarkSeen: boolean;
  onMarkSeen: () => void;
}

/**
 * The actions of the title row of the detail: Fork, Pin, Mark as seen. The A/B question `ui-header-actions`: three icon buttons (inline, the default), one
 * More actions menu, or a labelled Fork with a chevron menu (split). A disabled action always says why (tooltip, or the text under the item).
 */
export function HeaderActions(props: HeaderActionsProps) {
  const variant = useUiVariant('headerActions');
  const { busy, onFork, forkBlocked, forkMeaning, pinned, onTogglePin, canMarkSeen, onMarkSeen } = props;
  const fork: MenuItem = { id: 'fork', icon: GitFork, label: 'Fork', disabled: busy || forkBlocked !== undefined, reason: forkBlocked ?? forkMeaning, run: onFork };
  const pin: MenuItem = { id: 'pin', icon: pinned ? PinOff : Pin, label: pinned ? 'Unpin' : 'Pin', disabled: busy, run: onTogglePin };
  const seen: MenuItem = { id: 'seen', icon: CheckCheck, label: 'Mark as seen', disabled: busy || !canMarkSeen, reason: canMarkSeen ? undefined : 'only a Done session has something to mark', run: onMarkSeen };
  if (variant === 'menu') {
    return <ActionsMenu label="More actions" trigger={<Ellipsis aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />} items={[fork, pin, seen]} />;
  }
  if (variant === 'split') {
    return (
      <div className="flex shrink-0 items-center">
        <Tooltip content={fork.disabled && fork.reason !== undefined ? `Fork: ${fork.reason}` : forkMeaning}>
          <button type="button" disabled={fork.disabled} onClick={fork.run} className={`inline-flex h-am-hit items-center gap-1.5 rounded-l border border-border px-2.5 text-sm text-content hover:bg-muted-bg disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}>
            <GitFork aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            Fork
          </button>
        </Tooltip>
        <ActionsMenu label="More actions" trigger={<ChevronDown aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />} items={[pin, seen]} split />
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton icon={fork.icon} label={fork.label} disabled={fork.disabled} disabledReason={fork.reason} onClick={fork.run} />
      <IconButton icon={pin.icon} label={pin.label} disabled={pin.disabled} onClick={pin.run} />
      <IconButton icon={seen.icon} label={seen.label} disabled={seen.disabled} disabledReason={seen.reason} onClick={seen.run} />
    </div>
  );
}
