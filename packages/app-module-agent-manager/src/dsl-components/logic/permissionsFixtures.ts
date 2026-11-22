import type { GrantDto, GuardrailsOverviewDto, SessionBlocksDto } from '../shared.js';

/** A GET /guardrails/overview answer with these grants and counters (tests). */
export const overview = (grants: GrantDto[], sessions: SessionBlocksDto[] = []): GuardrailsOverviewDto => ({
  ok: true,
  generatedAt: 'x',
  killSwitch: { active: false, path: '', errorText: '' },
  projects: [],
  sourcesText: [],
  grants,
  sessions,
  configs: [],
  problems: [],
  hiddenEntries: 0,
  rulesNote: '',
  formatVersion: 1,
});
