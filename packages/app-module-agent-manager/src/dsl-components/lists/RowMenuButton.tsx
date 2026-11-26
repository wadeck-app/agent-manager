import { Tooltip } from '@wadeck-app/dsl-ui';
import { MoreHorizontal } from 'lucide-react';
import { RowIconButton } from './RowIconButton.js';

/**
 * The always visible, low emphasis "..." button of a row (the shared RowIconButton, no hover reveal: it is there for touch and for discovery). It opens the
 * menu under itself. Not a tab stop, like every row button: the keyboard opens the same menu from the row (context-menu key or Shift+F10).
 * It sits in a fixed 24 px column (the 28 px button overflows it by 2 px on each side, so the name keeps the room): the buttons of all the rows are one vertical axis.
 */
export function RowMenuButton({ name, onMenu }: { name: string; onMenu: (anchor: { x: number; y: number }) => void }) {
  return (
    <span data-row-menu-column="" className="flex h-7 w-6 shrink-0 items-center justify-center">
      <Tooltip content="Actions: move, flag, pin, mark seen (right-click)" side="left">
        <RowIconButton
          label={`Actions of ${name}`}
          aria-haspopup="menu"
          data-row-menu-button=""
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            onMenu({ x: box.left, y: box.bottom + 2 });
          }}
          icon={<MoreHorizontal aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />}
        />
      </Tooltip>
    </span>
  );
}
