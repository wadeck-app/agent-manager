import { ButtonAction } from '@wadeck-app/dsl-ui';
import { Plus } from 'lucide-react';

/**
 * The footer of the list pane: New session, always visible under the list (the list scrolls above it, the footer never does), so the main action of the page is
 * at the same place with 3 sessions and with 300, and not in the crowded toolbar. It is part of the list pane, so the detail pane never moves it, and below the
 * lg breakpoint (where the detail replaces the list) it goes away with the list.
 */
export function ListFooter({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div data-list-footer="" className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-3 py-2">
      <ButtonAction variant="primary" size="sm" icon={<Plus aria-hidden="true" className="h-3.5 w-3.5" />} label="New session" onClick={onNewSession} />
    </div>
  );
}
