import { useContext, useEffect, useRef } from 'react';
import { ButtonAction } from '@wadeck-app/dsl-ui';
import type { BannerTone } from './Banner.js';
import { SetterContext } from './bannerStackKit.js';
import { FoldedBanner } from './FoldedBanner.js';

/**
 * A message for the stack of the page (draws nothing itself). Without a stack above it, it is a folded banner of its own, so it never goes missing.
 * `onAction` may change at every render: only the latest is called.
 */
export function StackedBanner({ id, tone, text, action }: { id: string; tone: BannerTone; text: string; action?: { label: string; onClick: () => void } | undefined }) {
  const stack = useContext(SetterContext);
  const latest = useRef(action?.onClick);
  latest.current = action?.onClick;
  const label = action?.label;
  useEffect(() => {
    if (stack === null) {
      return undefined;
    }
    stack(id, { tone, text, actionLabel: label }, () => latest.current?.());
    return () => stack(id, undefined, () => undefined);
  }, [stack, id, tone, text, label]);
  if (stack !== null) {
    return null;
  }
  return <FoldedBanner tone={tone} text={text} action={action === undefined ? undefined : <ButtonAction variant="secondary" size="sm" label={action.label} onClick={action.onClick} />} />;
}
