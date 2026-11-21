import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { clearJsonCache, countersFileOf, grantsFileOf, rulesFileOf, stateDirOf } from './guardrailsFiles.js';
import { clearGuardrailsCaches } from './guardrailsRoutes.js';
import { JOURNAL_DIR_PARTS, JOURNAL_PREFIX, JOURNAL_SUFFIX } from './guardrailsNames.js';

/** Test-only: a temp "home" (journal, kill switch) and temp project folders holding plugin files. Nothing outside the temp folder is read. */

export interface Home {
  /** The fake home folder. */
  home: string;
  /** A new project folder (absolute, local). */
  project: (name: string) => string;
  journalDir: string;
}

export function useHome(): Home {
  const box: Home = { home: '', journalDir: '', project: () => '' };
  let root = '';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-manager-guardrails-'));
    box.home = join(root, 'home');
    box.journalDir = join(box.home, ...JOURNAL_DIR_PARTS);
    mkdirSync(box.journalDir, { recursive: true });
    box.project = (name: string) => {
      const dir = join(root, 'projects', name);
      mkdirSync(dir, { recursive: true });
      return dir;
    };
    clearJsonCache();
    clearGuardrailsCaches();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  return box;
}

const json = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));

export function putGrants(project: string, content: unknown): void {
  mkdirSync(stateDirOf(project), { recursive: true });
  writeFileSync(grantsFileOf(project), json(content));
}

export function putCounters(project: string, content: unknown): void {
  mkdirSync(stateDirOf(project), { recursive: true });
  writeFileSync(countersFileOf(project), json(content));
}

export function putRules(project: string, content: unknown): void {
  mkdirSync(join(project, '.claude'), { recursive: true });
  writeFileSync(rulesFileOf(project), json(content));
}

export function putJournal(journalDir: string, day: string, lines: readonly unknown[]): string {
  const file = join(journalDir, `${JOURNAL_PREFIX}${day}${JOURNAL_SUFFIX}`);
  writeFileSync(file, lines.map((line) => `${json(line)}\n`).join(''));
  return file;
}

export const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

export const grantEntry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'a1b2c3d4',
  category: 'rm',
  decision: 'allow',
  session_id: '287760ca-77b9-418b-bd68-c242d65b4d67',
  mode: 'ttl',
  expires: iso(30 * 60_000),
  reason: 'clean the build folder',
  ...overrides,
});

export const journalLine = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  ts: '2026-11-21T10:00:00.000Z',
  session: '287760ca:M',
  decision: 'deny',
  trigger: 'rm',
  project: '/work/shop',
  tool: 'Bash',
  command: 'rm -rf build',
  file: null,
  ...overrides,
});
