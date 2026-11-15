import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import type { ApiFailure } from '../commons/api.js';
import { RequestError, type RouteAnswer, type RouteRequest } from './routeKit.js';

/** The `{ ok: false, error }` answer of the log and reply routes. */
export function fail(status: number, code: string, message: string, hint: string): RouteAnswer {
  const body: ApiFailure = { ok: false, error: { code, message, hint } };
  return { status, body };
}

/** A request error of these routes with its own machine code (the status alone picks 'bad-request' or 'unknown-session'). */
export class CodedRequestError extends RequestError {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    hint: string,
  ) {
    super(status, message, hint);
    this.name = 'CodedRequestError';
  }
}

/**
 * Runs a route of the master-detail API: a RequestError (bad query, bad body) becomes the same `{ ok: false, error }` shape as every other failure
 * of these routes (instead of the generic BAD_REQUEST body), with its own HTTP status. Any other error is left to the route kit (500 and a log line).
 */
export function shaped(run: (req: RouteRequest) => Promise<RouteAnswer>): (req: RouteRequest) => Promise<RouteAnswer> {
  return async (req) => {
    try {
      return await run(req);
    } catch (error) {
      if (error instanceof RequestError) {
        return fail(error.status, error instanceof CodedRequestError ? error.code : error.status === 404 ? 'unknown-session' : 'bad-request', getErrorMessage(error), error.hint ?? 'Check the request and try again.');
      }
      throw error;
    }
  };
}
