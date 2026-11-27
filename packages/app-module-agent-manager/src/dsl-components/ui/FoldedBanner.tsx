import { useState, type ReactNode } from 'react';
import { prose } from '../logic/prose.js';
import { FOCUS_RING } from './focusRing.js';
import { Banner, type BannerTone } from './Banner.js';
import { RowButton } from './RowButton.js';

/** A text longer than this is folded to two lines behind "Show more". */
export const FOLD_AT = 150;

const TOGGLE = `shrink-0 self-start rounded text-xs text-primary underline hover:no-underline ${FOCUS_RING}`;

export interface FoldedBannerProps {
  tone: BannerTone;
  text: string;
  /** The action that can fix it ("Retry"), rendered at the end. */
  action?: ReactNode;
}

/**
 * A Banner for a text that can be long (the reason and the fix of a transport, a refusal of the daemon): the text is made a sentence (`prose`), and when it is
 * long it shows two lines with "Show more" / "Show less", so two such banners never eat the log. The whole text is always one click away, never cut.
 */
export function FoldedBanner({ tone, text, action }: FoldedBannerProps) {
  const [open, setOpen] = useState(false);
  const sentence = prose(text);
  const long = sentence.length > FOLD_AT;
  return (
    <Banner
      tone={tone}
      action={
        <>
          {long ? (
            <RowButton type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={TOGGLE}>
              {open ? 'Show less' : 'Show more'}
            </RowButton>
          ) : null}
          {action}
        </>
      }
    >
      <span data-folded={long && !open ? 'true' : 'false'} className={long && !open ? 'line-clamp-2' : ''}>
        {sentence}
      </span>
    </Banner>
  );
}
