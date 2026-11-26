import { IconButton, Tooltip } from '@wadeck-app/dsl-ui';
import type { ComponentProps } from 'react';

export type TipIconButtonProps = Omit<ComponentProps<typeof IconButton>, 'title'> & {
  /** What the tooltip says, when it says more than the accessible name (limits, shortcut, why the button is off). Same text as the name: use IconButton alone. */
  tip: string;
};

/**
 * An IconButton whose tooltip is longer than its accessible name. The dsl-ui IconButton shows its aria-label as the tooltip, except when the caller gives a `title`
 * (then it renders the bare button and leaves the browser's native tooltip). An EMPTY title is the way to say "my own tooltip is around me": no native tooltip, no second dsl-ui one.
 * This is the one place of the module that passes a title to an IconButton (ui/noNativeTitle.test.ts); it goes away when the dsl-ui IconButton has a tooltip prop.
 */
export function TipIconButton({ tip, ...rest }: TipIconButtonProps) {
  return (
    <Tooltip content={tip}>
      <IconButton {...rest} title="" />
    </Tooltip>
  );
}
