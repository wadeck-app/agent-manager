import { isAbsolute } from 'node:path';
import { ReplyError, assertSafeId } from './errors.js';

/** Longest user text accepted (characters). */
export const MAX_TEXT_CHARS = 20_000;

/** The marker that starts every delivered text (decision 11). It states the origin, not trust (decision 31). */
export function originMarkerFor(id: string): string {
  return `[web reply via agent-manager #${id}]`;
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
  /** Default: `[web reply via agent-manager #<id>]`; null: no marker line at all. */
  originMarker?: string | null;
}

/**
 * The text the session receives: the origin marker on the first line, the user text, then one line per image
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
  const marker = input.originMarker === undefined ? originMarkerFor(input.id) : input.originMarker;
  const lines = marker === null ? [] : [marker];
  if (input.text !== '') {
    lines.push(input.text);
  }
  for (const path of input.imagePaths) {
    lines.push(`The user attached an image: ${path}. Read it.`);
  }
  return lines.join('\n');
}
