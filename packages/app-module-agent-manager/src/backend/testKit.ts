
import { tmpdir } from 'node:os';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { socketTransport } from '@wadeck-app/agent-manager-core/reply';
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
  /** The path as registered ('/owned/:id/stop'). */
  subPath: string;
  /** The options the module gave to registerRoute (effect 'sensitive'). */
  options: { effect?: string } | undefined;
  segments: string[];
  handler: (req: unknown, reply: unknown) => unknown;
}

/** A module context that only records the routes, and `call` runs one the way app-core's router does (method, segments, decoded params). */
export function makeModule(setup: { dataDir?: string; options?: ModuleOptions } = {}): { call: (method: string, path: string, options?: CallOptions) => Promise<Call>; routes: string[]; registered: { key: string; effect: string | undefined }[] } {
  const routes: Route[] = [];
  const ctx = {
    dataDir: setup.dataDir ?? tmpdir(),
    registerRoute: (method: string, subPath: string, handler: Route['handler'], options?: { effect?: string }) => {
      routes.push({ method, subPath, options, segments: subPath.split('/').filter(Boolean), handler });
    },
  } as unknown as ModuleContext;
  // The default of the module also offers the hc transport, whose probe runs the real `hc`: tests get the socket transport alone unless they give their own.
  registerRoutes(ctx, { ...setup.options, transports: setup.options?.transports ?? [socketTransport] });

  const module: { call: (method: string, path: string, options?: CallOptions) => Promise<Call>; routes: string[]; registered: { key: string; effect: string | undefined }[] } = {
    registered: routes.map((r) => ({ key: `${r.method} ${r.subPath}`, effect: r.options?.effect })),
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
      // A local browser request of the web UI: same-origin, and (for a write) the token of GET /csrf. A test removes one with `headers: { name: undefined }`.
      const headers: Record<string, string | undefined> = { host: '127.0.0.1:4850', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(options.headers ?? {}) };
      if (method !== 'GET' && !('x-agent-manager-csrf' in (options.headers ?? {}))) {
        headers['x-agent-manager-csrf'] = ((await module.call('GET', '/csrf')).body as { token: string }).token;
      }
      for (const name of Object.keys(headers)) {
        if (headers[name] === undefined) {
          delete headers[name];
        }
      }
      await found.handler({ params, query, body: options.body, headers }, reply);
      return { status, body };
    },
  };
  return module;
}
