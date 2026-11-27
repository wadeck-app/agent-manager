import { HeaderActionsProvider, HeaderActionsSlot } from '@wadeck-app/dsl-ui';
import type { ReactNode } from 'react';

/**
 * The shell header slot for the tests that mount the whole workspace: the page header is in the breadcrumb row by default (A/B question `ui-header-placement`),
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
