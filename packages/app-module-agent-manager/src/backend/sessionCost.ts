import type { SessionCostDto } from '../commons/api.js';
import { subagentUsageOf, type SubagentUsageAnswer } from './subagentUsage.js';
import { sumCosts } from './sessionStatus.js';

/**
 * The estimated cost of a session: its main transcript (read whole and incrementally, not the tail window of the digest), the transcripts of its sub-agents
 * (`usages`, already read for the cards) and their sum. A transcript that gave no usage is counted in `withoutUsage` / explained by `mainNote`, never as zero dollars.
 */
export async function sessionCostOf(transcriptPath: string, usages: ReadonlyMap<string, SubagentUsageAnswer>): Promise<SessionCostDto> {
  const main = await subagentUsageOf({ transcriptPath });
  const mainCost = main.usage?.cost;
  const subCosts = [...usages.values()].flatMap((answer) => (answer.usage?.cost === undefined ? [] : [answer.usage.cost]));
  const subagents = { ...sumCosts(subCosts), agents: subCosts.length, withoutUsage: usages.size - subCosts.length };
  return {
    ...(mainCost !== undefined ? { main: mainCost } : { mainNote: main.note ?? 'No assistant message with usage in the transcript.' }),
    subagents,
    total: sumCosts(mainCost === undefined ? subCosts : [mainCost, ...subCosts]),
  };
}
