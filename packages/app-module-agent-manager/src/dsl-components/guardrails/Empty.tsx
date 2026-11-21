/** What an empty section says, with the reason (never a bare blank). */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div role="status" className="flex flex-col gap-1 p-3 text-sm">
      <p className="font-medium text-content">{title}</p>
      {hint === undefined ? null : <p className="text-muted">{hint}</p>}
    </div>
  );
}
