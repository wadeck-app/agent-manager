import * as fs from 'node:fs/promises';
import { basename } from 'node:path';
import { defaultConfigDir } from '@wadeck-app/agent-manager-core';
import { FolderError } from '@wadeck-app/agent-manager-core/folders';
import type { FolderRecentDto, FolderRecentOk, FolderRootsOk, FolderSearchOk } from '../commons/api.js';
import { CodedRequestError, shaped } from './apiError.js';
import type { OwnedSource } from './daemon/ownedSource.js';
import { gitInfo, listFolder, searchFolders, type GitInfo } from './folderBrowse.js';
import { createScopeCache, scopeNote } from './foldersScope.js';
import { ok, queryValue, type RouteKit, type RouteRequest } from './routeKit.js';

/** Recent folders sent. */
const MAX_RECENT = 50;
/** Longest search text. */
const MAX_QUERY_CHARS = 200;

/** The HTTP status of a folder error: the caller's mistake (400), a refusal (403), a folder that is not there (404). */
const STATUS: Record<string, number> = { 'folder-not-browsable': 403, 'folder-unreadable': 403, 'folder-not-found': 404 };

function statusOf(code: string): number {
  return STATUS[code] ?? 400;
}

/** Runs a folder route: a FolderError becomes `{ ok: false, error }` with its status, its code and its hint. */
function folders(run: (req: RouteRequest) => Promise<ReturnType<typeof ok>>): (req: RouteRequest) => Promise<ReturnType<typeof ok>> {
  return shaped(async (req) => {
    try {
      return await run(req);
    } catch (error) {
      if (error instanceof FolderError) {
        throw new CodedRequestError(statusOf(error.code), error.code, error.reason, error.fix);
      }
      throw error;
    }
  });
}


/**
 * The folder routes, all GET and read-only: they answer with the NAMES of folders (never a file or a content) inside the browsable roots (foldersScope.ts).
 * They are not PIN-protected (commons/routeClasses.ts says why).
 *  - GET /folders/roots: where the pickers may start.
 *  - GET /folders/list?path=: the subfolders of a folder inside the roots.
 *  - GET /folders/search?q=: fuzzy search over the known projects.
 *  - GET /folders/recent: the folders sessions and launches ran in.
 */
export function registerFoldersRoutes(kit: RouteKit, owned: OwnedSource): void {
  const scopes = createScopeCache(owned);
  const scopeOf = () => scopes.get(defaultConfigDir(process.env));
  kit.route(
    'GET',
    '/folders/roots',
    folders(async () => {
      const scope = await scopeOf();
      const body: FolderRootsOk = {
        ok: true,
        roots: scope.roots.map((root) => ({ path: root.path, name: root.name, source: root.source })),
        configFile: scope.configFile,
        configProblem: scope.configProblem,
        note: scopeNote(scope),
      };
      return ok(body);
    }),
  );

  kit.route(
    'GET',
    '/folders/list',
    folders(async (req) => {
      const path = queryValue(req.query, 'path');
      if (path === undefined) {
        throw new CodedRequestError(400, 'path-missing', "'path' is missing", 'Give the absolute path of a folder: /folders/list?path=<absolute folder>. GET /folders/roots lists where to start.');
      }
      return ok(await listFolder(path, await scopeOf()));
    }),
  );

  kit.route(
    'GET',
    '/folders/search',
    folders(async (req) => {
      const query = queryValue(req.query, 'q') ?? '';
      if (query.length > MAX_QUERY_CHARS) {
        throw new CodedRequestError(400, 'query-too-long', `'q' has ${query.length} characters, the limit is ${MAX_QUERY_CHARS}`, 'Type fewer characters.');
      }
      const scope = await scopeOf();
      const found = await searchFolders(query, scope);
      const body: FolderSearchOk = { ok: true, query, results: found.results, truncated: found.truncated, scanned: found.scanned, warnings: scope.known.warnings };
      return ok(body);
    }),
  );

  kit.route(
    'GET',
    '/folders/recent',
    folders(async () => {
      const scope = await scopeOf();
      const newest = [...scope.known.folders.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt || a.path.localeCompare(b.path)).slice(0, MAX_RECENT);
      const recent: FolderRecentDto[] = await Promise.all(
        newest.map(async (folder) => {
          const exists = await fs.stat(folder.path).then((stats) => stats.isDirectory(), () => false);
          const git: GitInfo = exists ? await gitInfo(folder.path) : { hasGit: false };
          return {
            name: basename(folder.path) === '' ? folder.path : basename(folder.path),
            path: folder.path,
            hasGit: git.hasGit,
            isRecent: true,
            isKnownProject: true,
            isLink: false,
            ...(git.branch === undefined ? {} : { branch: git.branch }),
            lastUsedAt: folder.lastUsedAt,
            uses: folder.uses,
            exists,
          };
        }),
      );
      const body: FolderRecentOk = { ok: true, folders: recent, warnings: scope.known.warnings };
      return ok(body);
    }),
  );
}
