const DOTS = '...';

/** Text cut in the middle to at most `max` characters, the start and the end kept (the end of a name is what tells two files apart). */
function middleCut(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const keep = Math.max(1, max - DOTS.length);
  const front = Math.floor(keep / 2);
  return `${text.slice(0, front)}${DOTS}${text.slice(text.length - (keep - front))}`;
}

/**
 * A folder path shortened in the middle to at most `max` characters: the first segment (a drive or the first folder), three dots, then as many of the last
 * segments as fit. The full path stays where the caller puts it (a tooltip). A path that fits is returned unchanged.
 */
export function shortenPath(path: string, max: number): string {
  if (path.length <= max) {
    return path;
  }
  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(sep);
  const head = parts[0] === '' ? `${sep}${parts[1] ?? ''}` : (parts[0] ?? '');
  const rest = parts.slice(parts[0] === '' ? 2 : 1);
  if (rest.length < 2) {
    return middleCut(path, max);
  }
  const prefix = `${head}${sep}${DOTS}${sep}`;
  const tail: string[] = [];
  for (let at = rest.length - 1; at >= 1; at -= 1) {
    const candidate = [rest[at] as string, ...tail];
    if (prefix.length + candidate.join(sep).length > max) {
      break;
    }
    tail.unshift(rest[at] as string);
  }
  if (tail.length > 0) {
    return `${prefix}${tail.join(sep)}`;
  }
  const last = rest[rest.length - 1] as string;
  const room = max - prefix.length;
  return room >= 6 ? `${prefix}${middleCut(last, room)}` : middleCut(path, max);
}
