import { ReplyError } from '../reply/errors.js';

/**
 * An error of the launch side (an owned session). Same shape as ReplyError (code, reason, fix; `message` carries both) so that a caller that
 * handles reply errors handles these too. Never carries a token.
 */
export class LaunchError extends ReplyError {
  constructor(code: string, reason: string, fix: string) {
    super(code, reason, fix);
    this.name = 'LaunchError';
  }
}
