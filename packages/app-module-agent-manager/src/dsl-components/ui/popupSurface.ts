/**
 * The one look of every popup of the module (layout menu, notices, text size, shortcuts, row menu, batch popup, dialogs, composer popovers): a 1 px border that
 * is visible on the page, an opaque surface that differs from the page, a deep shadow. The page is `bg-surface` (white, then slate-800), the default popup look
 * (`border-border bg-surface shadow-lg`) was 1.2:1 against it. The colors are computed from the theme tokens at the element, so light and dark follow the shell:
 *
 * - border: the divider token mixed 60 % toward the muted text color (2.6:1 on the white page, 3.4:1 on the dark one; the old border token was 1.2 and 1.4);
 * - surface: the page surface mixed half and half with the muted background (off-white in light, one step lighter in dark: a popup is "raised");
 * - shadow: a long soft one and a short tight one (the dark theme leans on the border, a black shadow is faint there).
 *
 * The classes are written in full (a class built at run time generates no CSS rule); popupSurface.test.ts checks that they say what the constants below say.
 * A popup the library portals out of the module scope (the row menu is the library ContextMenu) cannot use the classes: styles/agents.css has a rule for it with the same values.
 */
export const POPUP_BORDER = 'color-mix(in srgb, var(--color-border) 40%, var(--color-muted))';
export const POPUP_BG = 'color-mix(in srgb, var(--color-surface) 50%, var(--color-muted-bg))';
export const POPUP_SHADOW = '0 12px 32px -4px rgb(0 0 0 / 0.28), 0 2px 6px rgb(0 0 0 / 0.14)';
/** The divider between two sections of a popup: lighter than the border of the box, still visible on the popup surface. */
export const POPUP_DIVIDER = 'color-mix(in srgb, var(--color-border) 60%, var(--color-muted))';

// @formatter:off
/** The box of a popup: rounded, bordered, opaque, raised. Add the placement and the padding. */
export const POPUP_SURFACE = 'rounded-lg border border-[color:color-mix(in_srgb,var(--color-border)_40%,var(--color-muted))] bg-[color:color-mix(in_srgb,var(--color-surface)_50%,var(--color-muted-bg))] shadow-[0_12px_32px_-4px_rgb(0_0_0/0.28),0_2px_6px_rgb(0_0_0/0.14)]';
/** The line between two sections of a popup (a border-top on the element that starts the next section). */
export const POPUP_SECTION = 'border-t border-[color:color-mix(in_srgb,var(--color-border)_60%,var(--color-muted))]';
// @formatter:on

