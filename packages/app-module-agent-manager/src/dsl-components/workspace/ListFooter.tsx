import { ButtonAction } from '@wadeck-app/dsl-ui';
import { Plus } from 'lucide-react';
import { NewGroupControl } from './NewGroupControl.js';

const FOOTER_CLASS = 'relative flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface px-2 py-1.5';

/**
 * The action bar of the list pane: New session and (Tree and Custom only) New group, always visible under the list (the list scrolls above it, the bar never
 * does), so the main actions of the page are at the same place with 3 sessions and with 300, and not in the crowded toolbar. Quiet on purpose, like the small
 * buttons of Herdr (no solid fill): the base secondary button at the small size. It is part of the list pane, so the detail pane never moves it, and below the
 * lg breakpoint (where the detail replaces the list) it goes away with the list. It is the positioned ancestor of the New group popup, which opens above it.
 */
export function ListFooter({ onNewSession, onNewGroup }: { onNewSession: () => void; /** Creates a custom group with this name; resolves true when it was created. Absent: no New group button (only the Tree and Custom lists show groups). */ onNewGroup?: (name: string) => Promise<boolean> }) {
  return (
    <div data-list-footer="" className={FOOTER_CLASS}>
      <ButtonAction variant="secondary" size="sm" icon={<Plus aria-hidden="true" className="h-3.5 w-3.5" />} label="New session" onClick={onNewSession} />
      {onNewGroup === undefined ? null : <NewGroupControl onCreate={onNewGroup} />}
    </div>
  );
}
