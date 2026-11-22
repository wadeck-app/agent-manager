import { expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

/** Opens the notices panel (the toolbar button) and the long texts in it, then waits for the full text: the page itself only shows the button. */
export async function expectNoticeDetails(text: RegExp): Promise<void> {
  if (screen.queryByRole('dialog', { name: 'Notices' }) === null) {
    fireEvent.click(await screen.findByRole('button', { name: /^\d+ notices?$/ }, { timeout: 3500 }));
  }
  for (const more of screen.queryAllByRole('button', { name: 'More' })) {
    fireEvent.click(more);
  }
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
}
