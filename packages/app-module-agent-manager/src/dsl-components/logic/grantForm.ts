import { GRANT_MODES, MAX_RATIONALE_CHARS } from '../shared.js';
import type { GrantModeDto, RuleCategoryDto } from '../shared.js';

/*
 * The pure parts of the Add bypass dialog (threat-model T-23): the choices, the sentences, the checks the server repeats.
 */

export interface ModeChoice {
  value: GrantModeDto;
  label: string;
  /** What the choice means, for the tooltip. */
  meaning: string;
}

const MODE_TEXT: Record<GrantModeDto, { label: string; meaning: string }> = {
  once: { label: 'once', meaning: 'One use: the bypass is gone after the guardrail was lifted once.' },
  '10m': { label: '10 min', meaning: 'Every matching call of the session for 10 minutes.' },
  '30m': { label: '30 min', meaning: 'Every matching call of the session for 30 minutes.' },
  '4h': { label: '4 h', meaning: 'Every matching call of the session for 4 hours.' },
};

/** The four durations the plugin accepts, the safest first. */
export const MODE_CHOICES: readonly ModeChoice[] = GRANT_MODES.map((value) => ({ value, ...MODE_TEXT[value] }));

/** "once", "10 min", "30 min", "4 h". */
export function modeWords(mode: GrantModeDto): string {
  return MODE_TEXT[mode].label;
}

export function decisionWords(decision: RuleCategoryDto['decision']): string {
  return decision === 'deny' ? 'denied' : decision === 'ask' ? 'asks' : 'allowed';
}

export function sourceWords(source: RuleCategoryDto['source']): string {
  return source;
}

/** The categories a bypass can lift, in the plugin's order. */
export function addableCategories(rules: readonly RuleCategoryDto[]): RuleCategoryDto[] {
  return rules.filter((rule) => rule.bypassable);
}

/** The options of the category select: the name and what the guardrail does now. */
export function categoryOptions(rules: readonly RuleCategoryDto[]): { value: string; label: string }[] {
  return rules.map((rule) => ({ value: rule.name, label: `${rule.name}: ${decisionWords(rule.decision)} (${sourceWords(rule.source)})` }));
}

/** The same checks as the server (backend/guardrailsAddRoutes.ts): '' when the text is fine, else the sentence to show. */
export function rationaleProblem(text: string): string {
  if (text.trim() === '') {
    return 'Say why this bypass is needed (one line): the plugin journal keeps it.';
  }
  const length = [...text].length;
  if (length > MAX_RATIONALE_CHARS) {
    return `The reason has ${length} characters, the limit is ${MAX_RATIONALE_CHARS}.`;
  }
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029) {
      return 'The reason must be on one line: remove the line breaks.';
    }
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return 'The reason has a control character: remove it.';
    }
  }
  return '';
}

/** The sentence the user confirms: what is lifted, for how long, for which session and folder. */
export function confirmLine(category: string, mode: GrantModeDto, sessionName: string, folder: string): string {
  const who = sessionName.trim() === '' ? 'this session' : sessionName.trim();
  return `Allow ${category} ${mode === 'once' ? '' : 'for '}${modeWords(mode)} in ${who} (${folder})`;
}
