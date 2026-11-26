import { expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

/** Opens the notices panel (the toolbar button), which shows every text whole, then waits for the text: the page itself only shows the button. */
export async function expectNoticeDetails(text: RegExp): Promise<void> {
  if (screen.queryByRole('dialog', { name: 'Notices' }) === null) {
    fireEvent.click(await screen.findByRole('button', { name: /^\d+ notices?$/ }, { timeout: 3500 }));
  }
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
}
