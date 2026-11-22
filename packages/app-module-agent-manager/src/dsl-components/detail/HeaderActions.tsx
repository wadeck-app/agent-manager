import { CheckCheck, ChevronDown, Ellipsis, GitFork, Pin, PinOff } from 'lucide-react';
import { ActionsMenu, type MenuItem } from './ActionsMenu.js';
import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { useUiVariant } from './deps.js';

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
      <div className="flex shrink-0 items-center gap-1">
<ButtonAction variant="secondary" size="sm" disabled={fork.disabled} disabledReason={fork.disabled ? fork.reason : undefined} onClick={fork.run} icon={<GitFork aria-hidden="true" className="h-4 w-4" />} label="Fork" />
        <ActionsMenu label="More actions" trigger={<ChevronDown aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />} items={[pin, seen]} split />
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton icon={<fork.icon aria-hidden="true" className="h-4 w-4" />} aria-label={fork.label} disabled={fork.disabled} disabledReason={fork.disabled ? fork.reason : undefined} onClick={fork.run} />
      <IconButton icon={<pin.icon aria-hidden="true" className="h-4 w-4" />} aria-label={pin.label} disabled={pin.disabled} onClick={pin.run} />
      <IconButton icon={<seen.icon aria-hidden="true" className="h-4 w-4" />} aria-label={seen.label} disabled={seen.disabled} disabledReason={seen.disabled ? seen.reason : undefined} onClick={seen.run} />
    </div>
  );
}
