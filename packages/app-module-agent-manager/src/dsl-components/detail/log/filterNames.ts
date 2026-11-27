import { LOG_CATEGORIES, type Filtered, type LogCategory } from './logFilters.js';

export const NAME: Record<LogCategory, { label: string; plural: string }> = {
  hooks: { label: 'Hooks', plural: 'hooks' },
  tools: { label: 'Tools', plural: 'tool calls' },
  agents: { label: 'Agent messages', plural: 'agent messages' },
  thinking: { label: 'Thinking', plural: 'thinking blocks' },
  queue: { label: 'Queue lines', plural: 'queue lines' },
};

/** "2 hooks, 1 agent message" of what the filters hide, for the tooltip of the marker. */
export function hiddenSentence(hidden: Filtered['hidden']): string {
  return LOG_CATEGORIES.filter((category) => hidden[category] > 0)
    .map((category) => `${hidden[category]} ${NAME[category].plural}`)
    .join(', ');
}
