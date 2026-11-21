import { Banner } from '../ui/Banner.js';

/** What the server says about the roots (none yet, a configured one that is gone): shown above the list, never swallowed. */
export function RootsNote({ note }: { note: string }) {
  return note === '' ? null : <Banner tone="warning">{note}</Banner>;
}
