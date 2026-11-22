import { ButtonAction } from '@wadeck-app/dsl-ui';
import { CircleDot, Flag, FlagOff, FolderInput } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { FloatingPanel } from '../ui/FloatingPanel.js';

/**
 * The menu of an agent row of the Custom mode (right-click, the context-menu key, or the kebab button): flag, mark as unread, move to a group. Choosing an
 * item acts and closes the menu. Mark as unread shows the blue "finished, not seen" dot until the agent is selected (the Herdr behavior).
 */
export function RowMenu({ session, anchor, onClose, onFlag, onUnread, onMove }: { session: AgentRow; anchor: { x: number; y: number }; onClose: () => void; onFlag: (flag: boolean) => void; onUnread: (unread: boolean) => void; onMove: () => void }) {
  const act = (run: () => void) => (): void => {
    onClose();
    run();
  };
  return (
    <FloatingPanel x={anchor.x} y={anchor.y} width={220} label={`Actions of ${session.displayName}`} onClose={onClose}>
      <div role="menu" className="flex flex-col items-start gap-1">
        <ButtonAction variant="secondary" size="sm" icon={session.flagged ? <FlagOff aria-hidden="true" className="h-3.5 w-3.5" /> : <Flag aria-hidden="true" className="h-3.5 w-3.5" />} label={session.flagged ? 'Remove the flag' : 'Flag'} onClick={act(() => onFlag(!session.flagged))} />
        <ButtonAction variant="secondary" size="sm" icon={<CircleDot aria-hidden="true" className="h-3.5 w-3.5" />} label={session.unread ? 'Mark as read' : 'Mark as unread'} onClick={act(() => onUnread(!session.unread))} />
        <ButtonAction variant="secondary" size="sm" icon={<FolderInput aria-hidden="true" className="h-3.5 w-3.5" />} label="Move to a group..." onClick={act(onMove)} />
      </div>
    </FloatingPanel>
  );
}
