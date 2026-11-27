// The wrapper span of the dsl-ui Tooltip is `inline-flex` and takes the `className` of the Tooltip. Two shapes of trigger need more than that (classes are static strings: Tailwind finds them by scanning the sources).

/** The trigger fills its container (a list row, a path button): the wrapper fills it too and may shrink under its content. */
export const TIP_FILL = '!flex flex-[1_1_100%] min-w-0 max-w-full';

/** The trigger truncates (a name, a path): the wrapper may shrink under its content instead of pushing the line wider. */
export const TIP_FIT = 'min-w-0 max-w-full';
