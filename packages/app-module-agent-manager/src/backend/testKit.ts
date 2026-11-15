
import { tmpdir } from 'node:os';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import registerRoutes from './index.js';
import type { ModuleOptions } from './replyRoutes.js';

export interface Call {
  status: number;
  // The routes answer plain JSON: the tests read it freely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Added to the headers of a local browser request (Host and Content-Type); a value of undefined removes the header. */
  headers?: Record<string, string | undefined>;
}

interface Route {
  method: string;
  segments: string[];
  handler: (req: unknown, reply: unknown) => unknown;
}

/** A module context that only records the routes, and `call` runs one the way app-core's router does (method, segments, decoded params). */
export function makeModule(setup: { dataDir?: string; options?: ModuleOptions } = {}): { call: (method: string, path: string, options?: CallOptions) => Promise<Call>; routes: string[] } {
  const routes: Route[] = [];
  const ctx = {
    dataDir: setup.dataDir ?? tmpdir(),
    registerRoute: (method: string, subPath: string, handler: Route['handler']) => {
      routes.push({ method, segments: subPath.split('/').filter(Boolean), handler });
    },
  } as unknown as ModuleContext;
  registerRoutes(ctx, setup.options);

  return {
    routes: routes.map((r) => `${r.method} /${r.segments.join('/')}`),
    async call(method, path, options = {}) {
      const [pathOnly = '', queryString] = path.split('?');
      const segments = pathOnly.split('/').filter(Boolean);
      const query: Record<string, unknown> = { ...(options.query ?? {}) };
      for (const [key, value] of new URLSearchParams(queryString ?? '')) {
        const previous = query[key];
        query[key] = previous === undefined ? value : [previous, value].flat();
      }
      const found = routes.find((r) => r.method === method && r.segments.length === segments.length && r.segments.every((s, i) => s.startsWith(':') || s === decodeURIComponent(segments[i]!)));
      if (found === undefined) {
        return { status: 404, body: { error: 'NO_ROUTE', message: `no route ${method} ${pathOnly}` } };
      }
      const params: Record<string, string> = { ...(options.params ?? {}) };
      found.segments.forEach((s, i) => {
        if (s.startsWith(':')) {
          params[s.slice(1)] = decodeURIComponent(segments[i]!);
        }
      });
      let status = 200;
      let body: unknown;
      const reply = {
        code(value: number) {
          status = value;
          return reply;
        },
        send(payload: unknown) {
          body = payload;
          return reply;
        },
      };
      const headers: Record<string, string | undefined> = { host: '127.0.0.1:4850', 'content-type': 'application/json', ...(options.headers ?? {}) };
      for (const name of Object.keys(headers)) {
        if (headers[name] === undefined) {
          delete headers[name];
        }
      }
      await found.handler({ params, query, body: options.body, headers }, reply);
      return { status, body };
    },
  };
}
