import type { ChipStyleVariant } from '../logic/uiVariants.js';

/**
 * The classes that colour a status chip in each style of the A/B question `ui-chip-style`. `bg` and `text` are the tone's classes written in full (a class
 * built at run time generates no CSS rule). `dot` chips keep the text neutral: the tone is carried by a dot (see ChipDot) and the label stays readable.
 */
export function chipSkin(style: ChipStyleVariant, bg: string, text: string): string {
  if (style === 'outline') {
    return `border border-current bg-transparent ${text}`;
  }
  if (style === 'dot') {
    return 'bg-transparent text-content';
  }
  return `${bg} ${text}`;
}

/** The small coloured dot of the `dot` style (in the tone's text colour, through currentColor). */
export function ChipDot({ text }: { text: string }) {
  return <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full bg-current ${text}`} />;
}
