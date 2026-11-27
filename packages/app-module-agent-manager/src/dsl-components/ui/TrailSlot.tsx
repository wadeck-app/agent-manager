import { HeaderActionsProvider, HeaderActionsSlot } from '@wadeck-app/dsl-ui';
import type { ReactNode } from 'react';

/**
 * The shell header slot for the tests that mount the whole workspace: the page header is always in the breadcrumb row (settled 2026-11-27),
 * and it is drawn through the slot of the shell, which a test does not have. The slot comes after the page, so the first element of the container stays the page.
 */
export function TrailSlot({ children }: { children: ReactNode }) {
  return (
    <HeaderActionsProvider>
      {children}
      <header data-testid="trail-slot">
        <HeaderActionsSlot />
      </header>
    </HeaderActionsProvider>
  );
}
