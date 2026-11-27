import type { CostDto, SessionCostDto } from '../deps.js';
import { formatUsd } from './format.js';

/** The models without a price of a cost, as "Name (3 messages)" pieces joined for a sentence. */
export function unpricedList(cost: CostDto): string {
  return cost.unpriced.map((item) => `${item.model === '' ? 'a message without model' : item.model} (${item.messages} message${item.messages === 1 ? '' : 's'})`).join(', ');
}

/** The one sentence every cost carries: what it is and what it rests on. */
export const costEstimateNote = (cost: CostDto): string => `Estimate computed by this app: tokens x Anthropic list prices (table of ${cost.asOf}), not your bill.`;

/**
 * How one estimated cost reads: the figure, or the explicit message when no message could be priced. A partial sum (some messages of a model without a price)
 * is shown as a lower bound ("at least $x") and says what is missing.
 */
export function costValue(cost: CostDto): { text: string; priced: boolean; partial: boolean; note: string } {
  if (cost.pricedMessages === 0 && cost.unpriced.length > 0) {
    const first = cost.unpriced[0]!;
    return { text: `No price for ${first.model === '' ? 'a message without model' : first.model}${cost.unpriced.length > 1 ? ` (+${cost.unpriced.length - 1} more)` : ''}`, priced: false, partial: false, note: `${first.reason}. ${unpricedList(cost)}: nothing invented.` };
  }
  if (cost.unpriced.length > 0) {
    return { text: `at least ${formatUsd(cost.usd)}`, priced: true, partial: true, note: `No price for ${unpricedList(cost)}: not in this sum. ${costEstimateNote(cost)}` };
  }
  return { text: formatUsd(cost.usd), priced: true, partial: false, note: costEstimateNote(cost) };
}

/**
 * Lines without a figure that say the very same thing ("No price for X" three times) become one line, labelled by the lines it stands for ("Cost" when it is
 * all of them). A line with a figure, or a different reason, stays as it is.
 */
function mergeIdentical(lines: CostLine[]): CostLine[] {
  const out: CostLine[] = [];
  for (const line of lines) {
    const same = line.missing ? lines.filter((other) => other.missing && other.value === line.value) : [];
    if (same.length < 2) {
      out.push(line);
    } else if (same[0] === line) {
      out.push({ label: same.length === lines.length ? 'Cost' : same.map((item) => item.label).join(', '), value: line.value, missing: true });
    }
  }
  return out;
}

export interface CostLine {
  label: string;
  value: string;
  /** The line has no figure (nothing priced, or nothing read). */
  missing: boolean;
}

/**
 * The lines of the cost tooltip of the header: the main session, its sub-agents (separate transcripts) and the total, plus one line for the models without a price.
 * Every line either has a figure or says why not ("No price for X", the read problem): never a zero that stands for "unknown".
 */
export function sessionCostLines(cost: SessionCostDto): CostLine[] {
  const lines: CostLine[] = [];
  if (cost.main === undefined) {
    lines.push({ label: 'Main session', value: cost.mainNote ?? 'Not available', missing: true });
  } else {
    const main = costValue(cost.main);
    lines.push({ label: 'Main session', value: main.text, missing: !main.priced });
  }
  const count = cost.subagents.agents + cost.subagents.withoutUsage;
  if (count === 0) {
    lines.push({ label: 'Sub-agents', value: 'None', missing: false });
  } else {
    const subs = costValue(cost.subagents);
    const label = `Sub-agents (${count})`;
    const text = cost.subagents.agents === 0 ? 'Not available' : subs.text;
    lines.push({ label, value: cost.subagents.withoutUsage > 0 ? `${text}; ${cost.subagents.withoutUsage} without usage` : text, missing: cost.subagents.agents === 0 || !subs.priced });
  }
  const total = costValue(cost.total);
  lines.push({ label: 'Total', value: total.text, missing: !total.priced });
  const merged = mergeIdentical(lines);
  if (cost.total.unpriced.length > 0) {
    merged.push({ label: 'Messages without price', value: unpricedList(cost.total), missing: true });
  }
  return merged;
}
