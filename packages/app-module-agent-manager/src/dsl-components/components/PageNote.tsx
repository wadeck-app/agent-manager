import { Scope } from '../ui/Scope.js';

export interface PageNoteProps {
  /** The note, one short paragraph of plain text. */
  text: string;
}

/**
 * A boxed note of a page (what feeds it, what is not built yet), in the body size of the module (the density scale). The base Markdown reads the browser
 * scale (14 px) next to a table that reads 15 px.
 *
 * @registryCategory atomic
 * @registryTags note text
 */
export function PageNote({ text }: PageNoteProps) {
  return (
    <Scope>
      {/* pt-4 = the space-y-4 of PageContent: the host wrapper of a custom component does not get that margin. */}
      <div className="pt-4">
        <p className="rounded-lg border border-border bg-surface p-3 text-sm text-content">{text}</p>
      </div>
    </Scope>
  );
}
