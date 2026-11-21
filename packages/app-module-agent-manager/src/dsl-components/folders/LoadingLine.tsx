import { LoaderCircle } from 'lucide-react';

/** A line that tells the list is being read. */
export function LoadingLine({ what }: { what: string }) {
  return (
    <p role="status" className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted">
      <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm animate-spin motion-reduce:animate-none" />
      {what}
    </p>
  );
}
