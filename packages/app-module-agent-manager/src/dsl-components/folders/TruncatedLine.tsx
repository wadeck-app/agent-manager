/** More subfolders exist than the server sends: said, with what to do. */
export function TruncatedLine({ limit }: { limit: number }) {
  return (
    <p role="status" data-truncated="" className="px-2 py-1.5 text-xs text-muted">
      Only the first {limit} folders are listed. Type more of the name in the filter, or type the path in the Folder field.
    </p>
  );
}
