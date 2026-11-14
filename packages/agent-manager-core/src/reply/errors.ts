/**
 * An error of the reply side. `message` already says what happened AND what to do (so a caller that prints only the message stays actionable);
 * `reason` and `fix` are the same two parts for a UI that shows them apart. Never carries a token (T-10).
 */
export class ReplyError extends Error {
  readonly code: string;
  readonly reason: string;
  readonly fix: string;

  constructor(code: string, reason: string, fix: string) {
    super(`${reason}. Fix: ${fix}`);
    this.name = 'ReplyError';
    this.code = code;
    this.reason = reason;
    this.fix = fix;
  }
}

/** A transport that exists as an interface only. Thrown by `send()` so that nothing can look sent when it was not. */
export class NotImplementedError extends ReplyError {
  constructor(transportId: string, milestone: string) {
    super('not-implemented', `the '${transportId}' reply transport is not implemented yet`, `${milestone}; use the 'socket' transport meanwhile`);
    this.name = 'NotImplementedError';
  }
}

/** Identifiers that become part of a file name or a socket frame: no path segment, no dot, so no '..'. */
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function assertSafeId(kind: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new ReplyError(
      'invalid-id',
      `the ${kind} is not a safe identifier (letters, digits, '_' and '-' only, 1 to 128 characters, got ${JSON.stringify(value)})`,
      `use a UUID or another identifier made of letters, digits, '_' and '-'`,
    );
  }
}
