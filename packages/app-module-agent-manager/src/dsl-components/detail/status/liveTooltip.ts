import { screen } from '@testing-library/react';

/**
 * The tooltip of the module (the portal one, shown on hover or focus). The base buttons with a disabled reason keep their own inline tooltip in the DOM
 * (hidden by CSS, `span.group > [role=tooltip]`), so `getByRole('tooltip')` alone is ambiguous when one is on the page.
 */
export function liveTooltip(): HTMLElement {
  const found = screen.getAllByRole('tooltip').filter((tip) => !(tip.parentElement?.classList.contains('group') ?? false));
  if (found.length !== 1) {
    throw new Error(`expected one shown tooltip of the module, found ${found.length}`);
  }
  return found[0]!;
}
