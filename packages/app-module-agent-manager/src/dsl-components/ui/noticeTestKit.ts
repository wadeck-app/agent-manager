import { expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

/** Opens the Details of the one notice line and waits for its full text: the line itself only says a short sentence. */
export async function expectNoticeDetails(text: RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Details' }, { timeout: 3500 }));
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
}
