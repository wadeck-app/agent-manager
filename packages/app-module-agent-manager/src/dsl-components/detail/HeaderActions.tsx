import { CheckCheck, GitFork, Pin, PinOff } from 'lucide-react';
import { IconButton } from '@wadeck-app/dsl-ui';

export interface HeaderActionsProps {
  /** An action of the header is running: the buttons wait. */
  busy: boolean;
  onFork: () => void;
  /** Why Fork is not possible now (shown as its tooltip); undefined when it is. */
  forkBlocked: string | undefined;
  forkMeaning: string;
  pinned: boolean;
  onTogglePin: () => void;
  canMarkSeen: boolean;
  onMarkSeen: () => void;
}

/**
 * The actions of the header of the open agent: Fork, Pin, Mark as seen, as three icon buttons at the right of the header line (the settled look of the
 * former A/B question "header actions"). An action that is off says why in its tooltip.
 */
export function HeaderActions(props: HeaderActionsProps) {
  const { busy, onFork, forkBlocked, forkMeaning, pinned, onTogglePin, canMarkSeen, onMarkSeen } = props;
  const forkOff = busy || forkBlocked !== undefined;
  const seenOff = busy || !canMarkSeen;
  const PinIcon = pinned ? PinOff : Pin;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton icon={<GitFork aria-hidden="true" className="h-4 w-4" />} aria-label="Fork" disabled={forkOff} disabledReason={forkOff ? (forkBlocked ?? forkMeaning) : undefined} onClick={onFork} />
      <IconButton icon={<PinIcon aria-hidden="true" className="h-4 w-4" />} aria-label={pinned ? 'Unpin' : 'Pin'} disabled={busy} onClick={onTogglePin} />
      <IconButton icon={<CheckCheck aria-hidden="true" className="h-4 w-4" />} aria-label="Mark as seen" disabled={seenOff} disabledReason={seenOff ? 'only a Done session has something to mark' : undefined} onClick={onMarkSeen} />
    </div>
  );
}
