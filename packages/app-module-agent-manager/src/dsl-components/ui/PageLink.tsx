import { ButtonAction, RouterContext } from '@wadeck-app/dsl-ui';
import { useContext } from 'react';

/**
 * A link to another page of the app, in the library's link look (ButtonAction `link`): it moves inside the shell through the router of dsl-ui, without reloading the page, and
 * keeps the focus ring and the keyboard activation of a button. Where no router is above it (a test, a component used alone) it loads the address, which still works but reloads.
 * Not for an address outside the app (a link of the log opens in a new tab: see detail/log/markdown.tsx).
 */
export function PageLink({ to, label, ariaLabel, size = 'xs' }: { to: string; label: string; ariaLabel?: string; size?: 'xs' | 'sm' }) {
  const router = useContext(RouterContext);
  return (
    <ButtonAction
      variant="link"
      size={size}
      label={label}
      {...(ariaLabel === undefined ? {} : { ariaLabel })}
      onClick={() => {
        if (router === null) {
          window.location.assign(to);
        } else {
          router.navigate(to);
        }
      }}
    />
  );
}
