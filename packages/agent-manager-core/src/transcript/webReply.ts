import type { WebReplyInfo } from './types.js';

/**
 * The marker line agent-manager puts in front of a reply it delivers (see reply/compose.ts): `[web reply via agent-manager #<id>]`. ANCHORED: it is the first
 * thing of the text, or follows the wrapper line Claude Code adds for a message from another session. A marker pasted or quoted further down is not ours.
 */
const MARKER = /^\s*(?:Another Claude session sent a message:[ \t]*\r?\n\s*)?\[web reply via agent-manager #([A-Za-z0-9_.-]{1,128})\][ \t]*\r?\n?/;

/** The paragraph Claude Code appends after a message from another session. */
const TRAILER = /\n\s*\nThis came from another Claude session[\s\S]*$/;

/**
 * A reply sent from agent-manager reaches the session as a message "from another Claude session": `Another Claude session sent a message:\n<marker>\n<text>\n\nThis
 * came from another Claude session ...`. Returns the id of the marker and the text the person wrote (what follows the marker line, without the trailing paragraph),
 * or undefined when the text does not START with the marker (a real message of another session, or a marker merely quoted). The caller only asks for entries
 * delivered as a peer message. The full text stays on the entry: nothing is lost.
 */
export function parseWebReply(text: string): WebReplyInfo | undefined {
  const match = MARKER.exec(text);
  const messageId = match?.[1];
  if (match === null || messageId === undefined) {
    return undefined;
  }
  const after = text.slice(match[0].length).replace(TRAILER, '');
  return { messageId, text: after.trim() };
}
