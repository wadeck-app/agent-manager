import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PROJECTS_DIR_ENV = 'AGENT_MANAGER_PROJECTS_DIR';

/**
 * The folder Claude Code keeps projects in: $AGENT_MANAGER_PROJECTS_DIR when set and non-blank (an override of agent-manager), else
 * $CLAUDE_CONFIG_DIR/projects when that is set (documented by Claude Code: sessions are stored there instead), else <home>/.claude/projects.
 */
export function resolveProjectsDir(env: NodeJS.ProcessEnv, home?: string): string {
  const override = env[PROJECTS_DIR_ENV];
  if (override !== undefined && override.trim() !== '') {
    return override;
  }
  const configDir = env['CLAUDE_CONFIG_DIR'];
  if (configDir !== undefined && configDir.trim() !== '') {
    return join(configDir, 'projects');
  }
  return join(home ?? homedir(), '.claude', 'projects');
}

/**
 * The folder name Claude Code gives a working directory: every character that is not an ASCII letter or digit becomes "-"
 * (C:\Workspace_Tooling\agent-manager -> C--Workspace-Tooling-agent-manager; C:\Users\Wadeck\.claude -> C--Users-Wadeck--claude).
 * Verified against the `cwd` field of the transcripts under ~/.claude/projects (see scripts/probe-real-transcripts.mjs --slugs). UNVERIFIED: very long
 * paths (Claude Code may shorten them); transcriptPath() falls back to a search by session id when the slug does not match.
 */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export type TranscriptPathError = {
  code: 'invalid-session-id' | 'projects-dir-missing' | 'not-found';
  message: string;
  /** What to do about it. */
  fix: string;
  /** Paths looked at. */
  tried: string[];
};

export type TranscriptPathResult =
  | {
      ok: true;
      /** `<projectsDir>/<folder>/<sessionId>.jsonl`. */
      path: string;
      /** The project folder (also holds `<sessionId>/subagents`). */
      projectDir: string;
      /** slug: found where the cwd slug points. search: found in another project folder (the slug differs from this machine's rule). */
      via: 'slug' | 'search';
    }
  | { ok: false; error: TranscriptPathError };

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Where the transcript of `sessionId` is. Tries `<projectsDir>/<slug of cwd>/<sessionId>.jsonl`, then looks for `<sessionId>.jsonl` in every
 * project folder (the most recently modified wins). Never an empty success: a miss is `{ ok: false, error }` naming what was tried.
 */
export async function transcriptPath(cwd: string, sessionId: string, projectsDir: string = resolveProjectsDir(process.env)): Promise<TranscriptPathResult> {
  // The session id becomes a file name: no separators or dots (path traversal).
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
    return {
      ok: false,
      error: { code: 'invalid-session-id', message: `"${sessionId}" is not a session id.`, fix: 'Pass the sessionId of the registry file (a UUID).', tried: [] },
    };
  }
  const direct = join(projectsDir, projectSlug(cwd), `${sessionId}.jsonl`);
  if (await isFile(direct)) {
    return { ok: true, path: direct, projectDir: join(projectsDir, projectSlug(cwd)), via: 'slug' };
  }
  let folders: string[];
  try {
    folders = (await readdir(projectsDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      error: {
        code: 'projects-dir-missing',
        message: `The projects folder cannot be read (${code ?? 'error'}): ${projectsDir}`,
        fix: `Check that Claude Code has run on this machine, or set ${PROJECTS_DIR_ENV} to the folder that holds the project folders.`,
        tried: [direct],
      },
    };
  }
  const found: { path: string; dir: string; mtime: number }[] = [];
  for (const folder of folders) {
    const candidate = join(projectsDir, folder, `${sessionId}.jsonl`);
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        found.push({ path: candidate, dir: join(projectsDir, folder), mtime: info.mtimeMs });
      }
    } catch {
      // not in this folder
    }
  }
  if (found.length === 0) {
    return {
      ok: false,
      error: {
        code: 'not-found',
        message: `No transcript for session ${sessionId} (cwd ${cwd}) under ${projectsDir}: tried ${direct} and ${folders.length} project folders.`,
        fix: 'The session may not have written a transcript yet (no prompt sent), or it was deleted by the Claude Code retention setting.',
        tried: [direct],
      },
    };
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return { ok: true, path: found[0]!.path, projectDir: found[0]!.dir, via: 'search' };
}
