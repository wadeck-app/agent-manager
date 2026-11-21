import type { WebReplyInfo } from './types.js';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
/** The exact shape of the message ids agent-manager makes: the page's `m-<base36 time>-<base36 random>`, or a UUID (the service default). */
const OUR_ID = `(?:m-[0-9a-z]{6,10}-[0-9a-z]{1,10}|${UUID})`;
const WRAPPER = '(?:Another Claude session sent a message:[ \\t]*\\r?\\n\\s*)?';

/**
 * The marker lines agent-manager puts in front of a reply it delivers when the `replyMarker` setting is short or full (see reply/compose.ts), ANCHORED: the first
 * thing of the text, or right after the wrapper line Claude Code adds for a message from another session. A marker pasted or quoted further down is not ours.
 * - full: `[web reply via agent-manager #<id>]`, any safe id (the form every earlier version emitted).
 * - short: `[agent-manager-web #<id>]`, only an id of OUR shape (the page's or a UUID): a person typing a tag by hand cannot match it by accident with a short word.
 * - `[web #<id>]`: an earlier, too easily typed form of short; read only with an id of our shape.
 * With the setting none (the default) there is no marker: a reply is then recognized by `origin.msg_id` (server side, see the log route), not here.
 */
const FULL = new RegExp(`^\\s*${WRAPPER}\\[web reply via agent-manager #([A-Za-z0-9_.-]{1,128})\\][ \\t]*\\r?\\n?`);
const SHORT = new RegExp(`^\\s*${WRAPPER}\\[(?:agent-manager-web|web) #(${OUR_ID})\\][ \\t]*\\r?\\n?`);

/** The paragraph Claude Code appends after a message from another session. */
const TRAILER = /\n\s*\nThis came from another Claude session[\s\S]*$/;
const LEADER = /^\s*Another Claude session sent a message:[ \t]*\r?\n\s*/;

/** The text of a message from another session without the line Claude Code puts before it and the paragraph it appends. Nothing else is touched. */
export function stripPeerWrapper(text: string): string {
  return text.replace(LEADER, '').replace(TRAILER, '').trim();
}

/**
 * A reply sent from agent-manager with a marker reaches the session as a message "from another Claude session": `Another Claude session sent a message:\n<marker>\n<text>\n\nThis
 * came from another Claude session ...`. Returns the id of the marker and the text the person wrote (what follows the marker line, without the trailing paragraph),
 * or undefined when the text does not START with a marker of ours (a real message of another session, a marker merely quoted, or a reply sent with marker none).
 * The caller only asks for entries delivered as a peer message. The full text stays on the entry: nothing is lost.
 */
export function parseWebReply(text: string): WebReplyInfo | undefined {
  const match = FULL.exec(text) ?? SHORT.exec(text);
  const messageId = match?.[1];
  if (match === null || messageId === undefined) {
    return undefined;
  }
  const after = text.slice(match[0].length).replace(TRAILER, '');
  return { messageId, text: after.trim() };
}
