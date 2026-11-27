/**
 * Wrapper classes that give a small quiet link or text button (a dsl-ui `ButtonAction` `link` or `ghost`, `xs`) a 24 px high hit area without changing what is drawn
 * (WCAG 2.2 target size, QA3 R14): the button gets a minimum height, the negative margin gives back the room, so the line does not grow. The look of these
 * variants has no fill or border, so the extra height shows nothing. Put it on the span around the button; classes written in full.
 */
export const LINK_HIT_AREA = '-my-1 inline-flex items-center [&>button]:min-h-6';
