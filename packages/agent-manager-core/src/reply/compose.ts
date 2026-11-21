import { isAbsolute } from 'node:path';
import { ReplyError, assertSafeId } from './errors.js';
import { DEFAULT_REPLY_MARKER, parseReplyMarker } from './replyMarker.js';
import type { ReplyMarkerMode } from './replyMarker.js';

/** Longest user text accepted (characters). */
export const MAX_TEXT_CHARS = 20_000;

/** The `full` marker line. It states the origin, not trust (decision 31). Which marker is sent is the `replyMarker` setting (D-2026-11-19-a). */
export function originMarkerFor(id: string): string {
  return `[web reply via agent-manager #${id}]`;
}

/** The `short` marker line: compact, still carries the message id. */
export function shortMarkerFor(id: string): string {
  return `[agent-manager-web #${id}]`;
}

/** The marker line of a mode, null for `none`. */
export function markerLineFor(id: string, mode: ReplyMarkerMode): string | null {
  return mode === 'none' ? null : mode === 'short' ? shortMarkerFor(id) : originMarkerFor(id);
}

/** Throws when the user text is longer than the cap. */
export function assertTextLength(text: string): void {
  if (text.length > MAX_TEXT_CHARS) {
    throw new ReplyError('text-too-long', `the reply text is ${text.length} characters, the maximum is ${MAX_TEXT_CHARS}`, 'shorten the text, or save it in a file in the project and send the path');
  }
}

export interface ComposeInput {
  text: string;
  /** Absolute paths of saved images. */
  imagePaths: readonly string[];
  id: string;
  /** The marker line: none (the text as typed), short (`[agent-manager-web #<id>]`) or full (`[web reply via agent-manager #<id>]`). Default: DEFAULT_REPLY_MARKER (none). */
  marker?: ReplyMarkerMode;
}

/**
 * The text the session receives: the origin marker on the first line (unless the mode is none), the user text, then one line per image
 * (`The user attached an image: <absolute path>. Read it.`). The text is capped to 20000 characters (explicit error beyond).
 */
export function composeMessageText(input: ComposeInput): string {
  assertSafeId('message id', input.id);
  if (typeof input.text !== 'string') {
    throw new ReplyError('invalid-text', 'the reply text must be a string', 'send the text as a string');
  }
  assertTextLength(input.text);
  if (input.text.trim() === '' && input.imagePaths.length === 0) {
    throw new ReplyError('empty-reply', 'the reply has no text and no image', 'type a text or attach an image');
  }
  for (const path of input.imagePaths) {
    if (!isAbsolute(path) || /[\r\n]/.test(path)) {
      throw new ReplyError('invalid-image-path', `the image path is not a single-line absolute path: ${JSON.stringify(path)}`, 'pass the absolute path returned by saveUpload');
    }
  }
  const marker = markerLineFor(input.id, parseReplyMarker(input.marker ?? DEFAULT_REPLY_MARKER, 'composeMessageText'));
  const lines = marker === null ? [] : [marker];
  if (input.text !== '') {
    lines.push(input.text);
  }
  for (const path of input.imagePaths) {
    lines.push(`The user attached an image: ${path}. Read it.`);
  }
  return lines.join('\n');
}
