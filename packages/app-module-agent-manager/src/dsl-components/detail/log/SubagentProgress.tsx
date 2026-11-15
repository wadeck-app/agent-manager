import { STATUS_LOOK, STATUS_ORDER, describeCounts, type SubagentCounts } from './subagentModel.js';

/** Segments of a bar (inline style: a width is data, not a utility). Order: running, failed, idle, finished. Not colour alone: the numbers are written next to it. */
export function SubagentProgress({ counts, slim = false }: { counts: SubagentCounts; slim?: boolean }) {
  if (counts.total === 0) {
    return null;
  }
  return (
    <div role="img" aria-label={describeCounts(counts)} className={`flex w-full overflow-hidden rounded-full bg-muted-bg ${slim ? 'h-1.5' : 'h-2.5'}`}>
      {STATUS_ORDER.map((status) => (counts[status] === 0 ? null : <span key={status} className={STATUS_LOOK[status].bar} style={{ width: `${(counts[status] / counts.total) * 100}%` }} />))}
    </div>
  );
}
