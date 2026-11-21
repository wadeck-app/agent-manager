import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { projectSlug, PROJECTS_DIR_ENV, resolveProjectsDir, transcriptPath } from './transcriptPath.js';
import { makeTempDir, removeDir, SESSION_ID } from './testFixtures.js';

// Windows-style working directories built from segments (the slug rule is tested on them whatever the OS of the test run).
const win = (...segments: string[]): string => segments.join('\\');
const SHOP = win('C:', 'work', 'shop');

const dirs: string[] = [];
function projects(): string {
  const dir = makeTempDir();
  dirs.push(dir);
  return dir;
}
function put(projectsDir: string, folder: string, mtimeSeconds?: number): string {
  mkdirSync(join(projectsDir, folder), { recursive: true });
  const path = join(projectsDir, folder, `${SESSION_ID}.jsonl`);
  writeFileSync(path, '{}\n');
  if (mtimeSeconds !== undefined) {
    utimesSync(path, mtimeSeconds, mtimeSeconds);
  }
  return path;
}
afterEach(() => {
  dirs.splice(0).forEach(removeDir);
});

describe('projectSlug', () => {
  it('turns every character that is not an ASCII letter or digit into a dash (names seen on a real machine)', () => {
    expect(projectSlug(win('C:', 'Workspace_Tooling', 'agent-manager'))).toBe('C--Workspace-Tooling-agent-manager');
    expect(projectSlug(win('C:', 'Users', 'Wadeck', '.claude'))).toBe('C--Users-Wadeck--claude');
    expect(projectSlug(win('C:', 'Users', 'Wadeck', 'AppData', 'Local', 'Temp', 'flow-test-iso-Cz8z5t', 'project'))).toBe('C--Users-Wadeck-AppData-Local-Temp-flow-test-iso-Cz8z5t-project');
    expect(projectSlug('/home/dev/my project')).toBe('-home-dev-my-project');
  });
});

describe('resolveProjectsDir', () => {
  it('uses the override when set and non-blank, else <home>/.claude/projects', () => {
    expect(resolveProjectsDir({ [PROJECTS_DIR_ENV]: '/x/p' }, '/h')).toBe('/x/p');
    expect(resolveProjectsDir({ [PROJECTS_DIR_ENV]: '  ' }, '/h')).toBe(join('/h', '.claude', 'projects'));
    // CLAUDE_CONFIG_DIR moves the projects of Claude Code itself; the agent-manager override wins over it.
    expect(resolveProjectsDir({ CLAUDE_CONFIG_DIR: '/c' }, '/h')).toBe(join('/c', 'projects'));
    expect(resolveProjectsDir({ CLAUDE_CONFIG_DIR: '/c', [PROJECTS_DIR_ENV]: '/x/p' }, '/h')).toBe('/x/p');
    expect(resolveProjectsDir({ CLAUDE_CONFIG_DIR: ' ' }, '/h')).toBe(join('/h', '.claude', 'projects'));
  });
});

describe('transcriptPath', () => {
  it('finds the transcript where the slug points', async () => {
    const dir = projects();
    const path = put(dir, 'C--work-shop');
    const result = await transcriptPath(SHOP, SESSION_ID, dir);
    expect(result).toEqual({ ok: true, path, projectDir: join(dir, 'C--work-shop'), via: 'slug' });
  });

  it('falls back to a search by session id when the folder differs, the most recent file winning', async () => {
    const dir = projects();
    put(dir, 'old-folder', 1_000_000);
    const recent = put(dir, 'other-folder', 2_000_000);
    const result = await transcriptPath(SHOP, SESSION_ID, dir);
    expect(result).toMatchObject({ ok: true, path: recent, projectDir: join(dir, 'other-folder'), via: 'search' });
  });

  it('returns an explicit not-found error with what was tried, never an empty success', async () => {
    const dir = projects();
    mkdirSync(join(dir, 'some-project'));
    const result = await transcriptPath(SHOP, SESSION_ID, dir);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatchObject({ code: 'not-found', message: expect.stringContaining(SESSION_ID) });
    expect(result.error.tried).toEqual([join(dir, 'C--work-shop', `${SESSION_ID}.jsonl`)]);
    expect(result.error.fix).not.toBe('');
  });

  it('explains a missing projects folder and refuses an id that is a path', async () => {
    const missing = join(projects(), 'nope');
    const result = await transcriptPath(SHOP, SESSION_ID, missing);
    expect(result).toMatchObject({ ok: false, error: { code: 'projects-dir-missing' } });
    const traversal = await transcriptPath(SHOP, '..\\..\\secret', projects());
    expect(traversal).toMatchObject({ ok: false, error: { code: 'invalid-session-id' } });
  });
});
