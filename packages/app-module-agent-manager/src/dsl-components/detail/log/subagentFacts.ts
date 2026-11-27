import { costValue } from '../status/costText.js';
import { contextTone, formatTokens } from '../status/format.js';
import { elapsedMs, formatElapsed, STATUS_LOOK, type SubagentItem } from './subagentModel.js';

/** One labelled row of the card of a sub-agent. `missing` rows say why the value is not there (never left out, never invented). */
export interface SubagentFact {
  label: string;
  /** The value, or "Not available". */
  value: string;
  /** A second, smaller line: what the value rests on, or why it is missing. */
  note?: string;
  missing?: boolean;
  /** The value follows the clock (a running sub-agent): it changes in place, the card is never rebuilt. */
  live?: boolean;
  /** Colour class of the value. */
  tone?: string;
}

/** What the status rests on, in words: the server only knows facts of the meta and the file times (see SubagentDto.status). */
function statusReason(item: SubagentItem): string {
  const { dto } = item;
  switch (item.status) {
    case 'failed':
      return dto.failureReason ?? 'the call that started it failed';
    case 'unknown':
      return dto.readError ?? 'its transcript could not be read';
    case 'active':
      return dto.lastActivityAt === undefined ? 'no transcript yet (just started?), probably running' : 'no end marker and written lately: probably running';
    case 'idle':
      return 'no end marker and silent for a while: it may be done or stuck';
    case 'finished':
      return 'marked finished in its meta';
  }
}

const missing = (label: string, reason: string): SubagentFact => ({ label, value: 'Not available', note: reason, missing: true });

/**
 * The facts of the hover card, only what the data says. `clock` writes an epoch ms as a date and time in the locale of the app. Tokens, model and context share
 * come from the usage of its transcript (`dto.usage`, the same definitions as the session header); the cost is an estimate (its messages x the price table of the core
 * package) and says so; a model without a price says "No price for <model>".
 */
export function subagentFacts(item: SubagentItem, now: number, clock: (at: number) => string): SubagentFact[] {
  const { dto } = item;
  const look = STATUS_LOOK[item.status];
  const usage = dto.usage;
  const why = dto.usageNote ?? 'No usage was read from its transcript.';
  const facts: SubagentFact[] = [{ label: 'Name', value: item.title }];
  facts.push(dto.agentType === undefined ? missing('Type', 'its meta has no agentType') : { label: 'Type', value: dto.isFork && dto.agentType !== 'fork' ? `${dto.agentType} (fork)` : dto.agentType });
  if (usage?.model !== undefined) {
    facts.push({ label: 'Model', value: usage.model.displayName, ...(usage.model.known || usage.model.id === undefined ? {} : { note: 'Not in the model table of this page' }) });
  } else if (dto.model !== undefined) {
    facts.push({ label: 'Model', value: dto.model, note: `From its meta, not a model id. ${why}` });
  } else {
    facts.push(missing('Model', why));
  }
  facts.push({ label: 'Status', value: look.label, note: statusReason(item), tone: look.text });
  facts.push(dto.startedAt === undefined ? missing('Started', 'no transcript yet') : { label: 'Started', value: clock(dto.startedAt) });
  const elapsed = elapsedMs(item, now);
  facts.push(elapsed === undefined ? missing('Duration', 'its start is unknown') : { label: 'Duration', value: formatElapsed(elapsed), live: item.status === 'active' });
  facts.push(
    dto.lastActivityAt === undefined
      ? missing('Last activity', 'no transcript yet')
      : { label: 'Last activity', value: item.status === 'active' ? `${formatElapsed(Math.max(0, now - dto.lastActivityAt))} ago` : clock(dto.lastActivityAt), live: item.status === 'active' },
  );
  if (usage?.tokensIn !== undefined || usage?.tokensOut !== undefined) {
    const parts = [usage.tokensIn === undefined ? undefined : `${formatTokens(usage.tokensIn)} in`, usage.tokensOut === undefined ? undefined : `${formatTokens(usage.tokensOut)} out`].filter((part) => part !== undefined);
    facts.push({
      label: 'Tokens',
      value: parts.join(' / '),
      note: 'Last call, like the session header',
    });
  } else {
    facts.push(missing('Tokens', why));
  }
  if (usage?.cost === undefined) {
    facts.push(missing('Cost', why));
  } else {
    const cost = costValue(usage.cost);
    facts.push({ label: 'Cost', value: cost.text, note: cost.note, ...(cost.priced ? {} : { missing: true }) });
  }
  const context = usage?.contextUsedPct;
  facts.push(
    context === undefined
      ? missing('Context', why)
      : { label: 'Context', value: `${context.value}%`, tone: contextTone(context.value).text, note: `${formatTokens(context.usedTokens)} tokens; auto-compact at ~${formatTokens(context.compactAtTokens)} (window ${formatTokens(context.windowTokens)} assumed)` },
  );
  return facts;
}
