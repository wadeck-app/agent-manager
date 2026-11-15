import type { SubagentDto } from '../deps.js';

export interface SubagentCounts {
  total: number;
  running: number;
  finished: number;
}

export function countSubagents(nodes: readonly SubagentDto[]): SubagentCounts {
  const counts: SubagentCounts = { total: 0, running: 0, finished: 0 };
  const visit = (list: readonly SubagentDto[]): void => {
    for (const node of list) {
      counts.total += 1;
      counts[node.finished ? 'finished' : 'running'] += 1;
      visit(node.children);
    }
  };
  visit(nodes);
  return counts;
}

export const subagentLabel = (node: SubagentDto): string => node.name ?? node.description ?? node.agentType ?? node.agentId.slice(0, 8);
