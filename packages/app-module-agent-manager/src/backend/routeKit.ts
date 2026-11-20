import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { createCsrf } from './csrf.js';

/** The parts of a Fastify request the routes read (the SDK types them loosely). */
export interface RouteRequest {
  params?: Record<string, string>;
  query?: Record<string, string | string[] | undefined>;
  /** The parsed JSON body of a write request (undefined when none was sent). */
  body?: unknown;
  /** The request headers (Fastify lower-cases the names). */
  headers?: Record<string, string | string[] | undefined>;
}

/** What a route returns: the HTTP status and the JSON body. */
export interface RouteAnswer {
  status: number;
  body: unknown;
}

export const ok = (body: unknown): RouteAnswer => ({ status: 200, body });

/** A request the route layer rejects: 400 unless said otherwise. `hint` says what to do. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

export interface RouteOptions {
  /** Registered with effect 'sensitive': app-core refuses the request without an access token (the PIN). See commons/routeClasses.ts. */
  sensitive?: boolean;
}

export interface RouteKit {
  /** Registers a route; every error thrown by `run` becomes its HTTP answer. */
  route(method: string, subPath: string, run: (req: RouteRequest) => Promise<RouteAnswer>, options?: RouteOptions): void;
  /** A token for the write routes (served by GET /csrf). */
  csrfToken(): string;
  /** The persistent folder of the module (ctx.dataDir): pins and seen markers live there. */
  readonly dataDir: string;
}

type Reply = { code(status: number): { send(body: unknown): unknown } };

/** A query parameter given at most once; empty means absent (a cleared filter sends `?name=`). */
export function queryValue(query: RouteRequest['query'], name: string): string | undefined {
  const value = query?.[name];
  if (Array.isArray(value)) {
    throw new RequestError(400, `'${name}' must be given once, got ${value.length} values`);
  }
  if (value !== undefined && typeof value !== 'string') {
    throw new RequestError(400, `'${name}' must be text`);
  }
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function failureOf(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof RequestError) {
    return { status: error.status, body: { error: 'BAD_REQUEST', message: getErrorMessage(error), ...(error.hint === undefined ? {} : { hint: error.hint }) } };
  }
  const message = getErrorMessage(error);
  return { status: 500, body: { error: 'INTERNAL', message: `Unexpected failure: ${message}`, hint: "Run 'agent-manager cli logs' and the app-core output, and report it with the request." } };
}

/**
 * `?inlineErrors=true`: the caller is a view whose source must not fail (a failed source blanks the whole page): the error is answered
 * 200 as data, with `errorText` (message and hint, one line) to display.
 */
function inline(failure: { status: number; body: Record<string, unknown> }): { status: number; body: Record<string, unknown> } {
  const message = typeof failure.body['message'] === 'string' ? failure.body['message'] : `Request failed with status ${failure.status}.`;
  const hint = typeof failure.body['hint'] === 'string' ? ` ${failure.body['hint']}` : '';
  return { status: 200, body: { ...failure.body, ok: false, failed: true, httpStatus: failure.status, errorText: `${message}.${hint}` } };
}

/**
 * app-core's shell fetcher (the only client that can answer the PIN dialog) throws the top-level `message` of an error body and nothing else, so a sensitive
 * route also puts "message. hint" there (the nested { error: { message, hint } } of the reply routes would become "[object Object]").
 */
function forShellFetcher(body: unknown): unknown {
  if (!isRecord(body)) {
    return body;
  }
  const nested = body['error'];
  const source = isRecord(nested) ? nested : body;
  const message = source['message'];
  const hint = source['hint'];
  if (typeof message !== 'string') {
    return body;
  }
  const text = typeof hint === 'string' && !message.includes(hint) ? `${message.replace(/.$/, '')}. ${hint}` : message;
  return { ...body, message: text };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Methods that never change state: every other method needs the same-origin and token check (T-08), whoever registers the route. */
const READ_METHODS = ['GET', 'HEAD'];

export function createRouteKit(ctx: ModuleContext, writeStderr: (text: string) => void = (text) => void process.stderr.write(text)): RouteKit {
  const csrf = createCsrf();
  return {
    dataDir: ctx.dataDir,
    csrfToken: csrf.issue,
    route(method, subPath, run, options) {
      ctx.registerRoute(method, subPath, async (req, reply) => {
        const raw = reply as unknown as Reply;
        const out: Reply = options?.sensitive === true ? { code: (status) => ({ send: (body) => raw.code(status).send(status >= 400 ? forShellFetcher(body) : body) }) } : raw;
        try {
          if (!READ_METHODS.includes(method.toUpperCase())) {
            const refusal = csrf.check((req as unknown as RouteRequest).headers);
            if (refusal !== undefined) {
              return out.code(403).send({ ok: false, error: refusal });
            }
          }
          const answer = await run(req as unknown as RouteRequest);
          return out.code(answer.status).send(answer.body);
        } catch (error) {
          const failure = failureOf(error);
          // Only unexpected failures: a 4xx is the caller's mistake and is already in its answer.
          if (failure.status >= 500) {
            const cause = error instanceof Error ? (error.stack ?? getErrorMessage(error)) : String(error);
            writeStderr(`[agent-manager module] ${method} ${subPath} failed with ${failure.status}: ${cause}\n`);
          }
          const query = (req as unknown as RouteRequest).query;
          const asData = query?.['inlineErrors'] === 'true' && method.toUpperCase() === 'GET';
          const answer = asData ? inline(failure) : failure;
          return out.code(answer.status).send(answer.body);
        }
      }, options?.sensitive === true ? { effect: 'sensitive' } : undefined);
    },
  };
}
