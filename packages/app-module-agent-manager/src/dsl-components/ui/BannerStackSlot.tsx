import { useContext } from 'react';
import { BannerStackBody } from './BannerStackBody.js';
import { TONE_RANK, ViewContext } from './bannerStackKit.js';

/** Where the one banner is drawn (nothing when no message is registered): put it where it must sit in the layout, below the provider. */
export function BannerStackSlot({ className }: { className: string }) {
  const stack = useContext(ViewContext);
  if (stack === null) {
    return null;
  }
  const entries = Object.entries(stack.items).sort((x, y) => TONE_RANK[x[1].tone] - TONE_RANK[y[1].tone]);
  const first = entries[0];
  if (first === undefined) {
    return null;
  }
  return (
    <div data-banner-stack="" className={className}>
      <BannerStackBody entries={entries} first={first} open={stack.open} onToggle={stack.toggle} run={stack.run} />
    </div>
  );
}
