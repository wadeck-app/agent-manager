/** A rectangle in window coordinates (the part of a DOMRect the decision needs). */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** An element that is not laid out (display none, width or height 0) has nothing to cover. */
function isEmpty(box: Box): boolean {
  return box.right <= box.left || box.bottom <= box.top;
}

/** A horizontal entry of a few pixels (the popup edge against the list pane edge) covers no button of the footer: it is not an overlap. */
const MIN_HORIZONTAL_COVER_PX = 12;

/** True when the two rectangles share some area (touching edges and slivers narrower than MIN_HORIZONTAL_COVER_PX do not count). */
export function overlaps(a: Box, b: Box): boolean {
  const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return !isEmpty(a) && !isEmpty(b) && horizontal >= MIN_HORIZONTAL_COVER_PX && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Where the popup must sit so it does not cover the list footer: the distance from the window bottom to the footer top (popup bottom = footer top), but ONLY
 * when the popup rectangle really overlaps the footer rectangle (a narrow window, where the popup spans the whole width). Otherwise undefined: the footer is
 * never moved and the popup keeps its own place (a layout shift on selection is what this avoids).
 */
export function footerClearance(popup: Box, footer: Box, windowHeight: number): number | undefined {
  return overlaps(popup, footer) ? Math.max(0, Math.round(windowHeight - footer.top)) : undefined;
}
