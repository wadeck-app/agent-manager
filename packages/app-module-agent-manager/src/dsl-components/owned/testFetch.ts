import { vi } from 'vitest';

export interface Call {
  method: string;
  path: string;
  /** The query string without the question mark ('path=%2Fwork'). */
  query: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface FakeAnswer {
  status?: number;
  body: unknown;
}


/** The folder routes of a machine with nothing to browse and nothing recent: the answers every test of the New session dialog gets unless it routes its own. */
export const EMPTY_FOLDER_ROUTES: Record<string, FakeAnswer> = {
  'GET /folders/roots': { body: { ok: true, roots: [], configFile: 'config.yml', note: '' } },
  'GET /folders/recent': { body: { ok: true, folders: [], warnings: [] } },
  'GET /folders/search': { body: { ok: true, query: '', results: [], truncated: false, scanned: 0, warnings: [] } },
};

type Handler = (call: Call) => FakeAnswer | Promise<FakeAnswer>;

/**
 * Replaces `fetch` with a router for the tests of the owned sessions: `routes` maps "METHOD /path" (the path after /api/modules/agent-manager, without the
 * query) to an answer or a function of the call. An unrouted request FAILS the test loudly (a 599 with the request in its text, and it is in `calls`).
 */
export function stubFetch(routes: Record<string, FakeAnswer | Handler>): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api/modules/agent-manager', '').replace(/\?.*$/, '');
      const method = init?.method ?? 'GET';
      const call: Call = { method, path, query: url.includes('?') ? url.slice(url.indexOf('?') + 1) : '', body: init?.body === undefined ? undefined : JSON.parse(String(init.body)), headers: { ...(init?.headers as Record<string, string> | undefined) } };
      calls.push(call);
      const route = routes[`${method} ${path}`] ?? EMPTY_FOLDER_ROUTES[`${method} ${path}`];
      if (route === undefined) {
        return new Response(JSON.stringify({ ok: false, error: { code: 'test-unrouted', message: `unrouted test request ${method} ${path}`, hint: 'add it to stubFetch' } }), { status: 599 });
      }
      const answer = typeof route === 'function' ? await route(call) : route;
      return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
    }),
  );
  return { calls };
}
