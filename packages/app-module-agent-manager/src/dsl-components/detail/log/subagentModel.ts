import { CircleCheck, CircleDashed, CircleHelp, CircleX, LoaderCircle, type LucideIcon } from 'lucide-react';
import type { SubagentDto } from '../deps.js';

/** What a sub-agent is shown as. The server's status (facts from the meta and the file times), upgraded to 'failed' when the call that started it is known to have failed. */
export type SubagentStatus = SubagentDto['status'];

export interface SubagentItem {
  dto: SubagentDto;
  status: SubagentStatus;
  /** 0 for a direct child of the session, 1 for a sub-agent started by a sub-agent, and so on. */
  depth: number;
  /** The words shown as its name. */
  title: string;
}

export type StatusFilter = 'all' | 'active' | 'failed' | 'finished';
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'active', 'failed', 'finished'];
// 'Active', not 'Running': the server only knows that the transcript was written lately and no end marker exists (see SubagentDto.status).
export const FILTER_LABEL: Record<StatusFilter, string> = { all: 'All', active: 'Active', failed: 'Failed', finished: 'Finished' };

export interface StatusLook {
  label: string;
  icon: LucideIcon;
  /** Colour of the icon (a semantic hue token). The shapes differ too: colour is never the only signal. */
  text: string;
  /** Fill of a bar segment of this status. */
  bar: string;
  iconClass: string;
}

/** Shape AND colour: a spinner (yellow) is active (written lately, no end marker: probably running), a check (green) finished, a cross (red) failed, a dashed circle (grey) idle. Classes are written in full for Tailwind. */
export const STATUS_LOOK: Record<SubagentStatus, StatusLook> = {
  active: { label: 'Active', icon: LoaderCircle, text: 'text-hue-yellow', bar: 'bg-hue-yellow', iconClass: 'animate-spin motion-reduce:animate-none' },
  finished: { label: 'Finished', icon: CircleCheck, text: 'text-hue-green', bar: 'bg-hue-green', iconClass: '' },
  failed: { label: 'Failed', icon: CircleX, text: 'text-hue-red', bar: 'bg-hue-red', iconClass: '' },
  idle: { label: 'Idle', icon: CircleDashed, text: 'text-muted', bar: 'bg-muted', iconClass: '' },
  unknown: { label: 'Status unknown', icon: CircleHelp, text: 'text-warning-text', bar: 'bg-muted', iconClass: '' },
};

export const STATUS_ORDER: readonly SubagentStatus[] = ['active', 'unknown', 'failed', 'idle', 'finished'];

export function subagentTitle(dto: SubagentDto): string {
  return dto.description ?? dto.name ?? `${dto.agentType ?? 'agent'} ${dto.agentId.slice(0, 7)}`;
}

/**
 * The sub-agents of the tree as one list, parents before their children (file order of the tree). `failedCalls` holds the tool_use ids of the calls that are
 * loaded and failed: a sub-agent whose call failed counts as failed whatever its own meta says (it never finished its job).
 */
export function flattenSubagents(tree: readonly SubagentDto[], failedCalls: ReadonlySet<string> = new Set(), depth = 0): SubagentItem[] {
  return tree.flatMap((dto) => {
    const failedByCall = dto.toolUseId !== undefined && failedCalls.has(dto.toolUseId);
    const status: SubagentStatus = failedByCall && dto.status !== 'active' ? 'failed' : dto.status;
    return [{ dto, status, depth, title: subagentTitle(dto) }, ...flattenSubagents(dto.children, failedCalls, depth + 1)];
  });
}

export interface SubagentCounts {
  total: number;
  active: number;
  unknown: number;
  failed: number;
  finished: number;
  idle: number;
}

export function countStatuses(items: readonly SubagentItem[]): SubagentCounts {
  const counts: SubagentCounts = { total: items.length, active: 0, unknown: 0, failed: 0, finished: 0, idle: 0 };
  for (const item of items) {
    counts[item.status] += 1;
  }
  return counts;
}

/** The headline: "69 of 70 done, 1 active, 2 failed". "Done" is finished plus failed (nothing more will happen to them). */
export function describeCounts(counts: SubagentCounts): string {
  const done = counts.finished + counts.failed;
  const parts = [`${done} of ${counts.total} done`];
  // "Active" is a guess from the file times (no end marker, written lately): said as such, never counted as certainly running.
  if (counts.active > 0) {
    parts.push(`${counts.active} active (no end marker)`);
  }
  if (counts.unknown > 0) {
    parts.push(`${counts.unknown} status unknown`);
  }
  if (counts.failed > 0) {
    parts.push(`${counts.failed} failed`);
  }
  if (counts.idle > 0) {
    parts.push(`${counts.idle} idle`);
  }
  return parts.join(', ');
}

export function filterItems(items: readonly SubagentItem[], filter: StatusFilter): SubagentItem[] {
  return filter === 'all' ? [...items] : items.filter((item) => item.status === filter);
}

/** What needs the eye first: active (the most recent first), then failed, then idle, then finished (the most recent first). Stable for equal starts. */
export function byAttention(items: readonly SubagentItem[]): SubagentItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => STATUS_ORDER.indexOf(a.item.status) - STATUS_ORDER.indexOf(b.item.status) || (b.item.dto.startedAt ?? 0) - (a.item.dto.startedAt ?? 0) || a.index - b.index)
    .map(({ item }) => item);
}

/** Milliseconds a sub-agent worked: until now while it runs, until its last write otherwise. Undefined when its start is unknown. */
export function elapsedMs(item: SubagentItem, now: number): number | undefined {
  const { startedAt, endedAt, lastActivityAt } = item.dto;
  if (startedAt === undefined) {
    return undefined;
  }
  const end = item.status === 'active' ? now : (endedAt ?? lastActivityAt ?? now);
  return Math.max(0, end - startedAt);
}

/** "last activity 12s ago", from the time of the last write and the CLIENT clock (the same clock as the live durations). */
export function lastActivityText(lastActivityAt: number, now: number): string {
  return `last activity ${formatElapsed(Math.max(0, now - lastActivityAt))} ago`;
}

/** "42s", "3m 05s", "1h 12m": exact enough to compare sub-agents, short enough for a row. */
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  }
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export interface TypeGroup {
  type: string;
  items: SubagentItem[];
  counts: SubagentCounts;
}

/** Grouped by agent type (the groups with something running or failed first, then by size). */
export function groupByType(items: readonly SubagentItem[]): TypeGroup[] {
  const groups = new Map<string, SubagentItem[]>();
  for (const item of items) {
    const type = item.dto.agentType ?? (item.dto.isFork ? 'fork' : 'agent');
    groups.set(type, [...(groups.get(type) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([type, list]) => ({ type, items: byAttention(list), counts: countStatuses(list) }))
    .sort((a, b) => b.counts.active + b.counts.failed - (a.counts.active + a.counts.failed) || b.items.length - a.items.length || a.type.localeCompare(b.type));
}

export interface TimelineBar {
  item: SubagentItem;
  /** Percent of the axis. */
  left: number;
  width: number;
}

export interface Timeline {
  from: number;
  to: number;
  bars: TimelineBar[];
  /** The most sub-agents that ran at the same moment. */
  peak: number;
  /** Items without a known start (not drawn). */
  undated: number;
}

/** Bars on a common time axis (start of the first to the end of the last, "now" for a running one), and the peak concurrency by a sweep over the edges. */
export function buildTimeline(items: readonly SubagentItem[], now: number): Timeline {
  const dated = items
    .map((item) => ({ item, start: item.dto.startedAt, end: item.status === 'active' ? now : (item.dto.endedAt ?? item.dto.lastActivityAt) }))
    .filter((entry): entry is { item: SubagentItem; start: number; end: number } => entry.start !== undefined && entry.end !== undefined);
  if (dated.length === 0) {
    return { from: now, to: now, bars: [], peak: 0, undated: items.length };
  }
  const from = Math.min(...dated.map((entry) => entry.start));
  const to = Math.max(...dated.map((entry) => entry.end), from + 1000);
  const span = to - from;
  const bars = dated
    .sort((a, b) => a.start - b.start)
    .map(({ item, start, end }) => ({ item, left: ((start - from) / span) * 100, width: Math.max(0.6, ((Math.max(end, start) - start) / span) * 100) }));
  const edges = dated.flatMap((entry) => [
    { at: entry.start, delta: 1 },
    { at: Math.max(entry.end, entry.start), delta: -1 },
  ]);
  // An end sorts before a start at the same instant: two that touch did not overlap.
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const edge of edges) {
    current += edge.delta;
    peak = Math.max(peak, current);
  }
  return { from, to, bars, peak, undated: items.length - dated.length };
}

/** Rows shown before "Show more": a list of 70 is a wall, 40 is about a screen at L. */
export const PAGE_SIZE = 40;
