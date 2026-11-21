/**
 * An error of the folder side (launch roots, browsing). `message` already says what happened AND what to do (a caller that prints only the message stays
 * actionable); `reason` and `fix` are the same two parts for a UI that shows them apart.
 */
export class FolderError extends Error {
  readonly code: string;
  readonly reason: string;
  readonly fix: string;

  constructor(code: string, reason: string, fix: string) {
    super(`${reason}. Fix: ${fix}`);
    this.name = 'FolderError';
    this.code = code;
    this.reason = reason;
    this.fix = fix;
  }
}
