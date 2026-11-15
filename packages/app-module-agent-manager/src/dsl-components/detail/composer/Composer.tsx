import { ComposerBody } from './ComposerBody.js';
export type { ComposerProps } from './types.js';
import type { ComposerProps } from './types.js';


/** The message box under the log. One instance per session (keyed), so switching sessions never mixes drafts, errors or confirmations. */
export function Composer({ session, reencode }: ComposerProps) {
  return <ComposerBody key={session.sessionId.toLowerCase()} session={session} reencode={reencode} />;
}

