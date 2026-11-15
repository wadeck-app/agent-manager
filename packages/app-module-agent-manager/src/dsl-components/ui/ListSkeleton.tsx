export function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading the sessions" aria-busy="true" className="flex flex-col gap-3 p-3">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div key={index} className="flex animate-pulse items-center gap-3 motion-reduce:animate-none">
          <div className="h-4 w-4 rounded-full bg-muted-bg" />
          <div className="h-3 flex-1 rounded bg-muted-bg" />
          <div className="h-3 w-8 rounded bg-muted-bg" />
        </div>
      ))}
    </div>
  );
}
