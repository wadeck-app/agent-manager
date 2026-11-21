import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { getErrorMessage } from '../../errors.js';
import { MAX_TEXT_CHARS } from '../../reply/compose.js';
import { MAX_UPLOAD_BYTES, detectImageExt } from '../../reply/uploads.js';
import { LaunchError } from '../errors.js';
import { assertForkSourceId, assertModel, assertPermissionMode, assertResumeSessionAt } from '../streamJsonArgs.js';
import type { ImageInput } from '../types.js';
import { HOST_KINDS } from './types.js';
import type { HostKind } from './types.js';

/*
 * Every body the API accepts is checked here, before anything runs. Each rejection is a LaunchError with the reason and the fix, so the HTTP
 * layer can answer 400 with something the caller can act on. Unknown fields are refused (a typo must not be ignored).
 */

export const MAX_IMAGES = 4;
export const MAX_NAME_CHARS = 64;
export const MAX_QUOTE_CHARS = 80;
export const MAX_CWD_CHARS = 1024;
export const MAX_DENY_MESSAGE_CHARS = 2000;
export const DEFAULT_DENY_MESSAGE = 'Denied by the user through agent-manager';
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as const;

function bad(code: string, reason: string, fix: string): never {
  throw new LaunchError(code, reason, fix);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectBody(value: unknown, allowed: readonly string[], example: string): Record<string, unknown> {
  if (!isRecord(value)) {
    return bad('invalid-body', 'the body must be a JSON object', `send ${example} with Content-Type: application/json`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return bad('unknown-field', `the field ${JSON.stringify(key)} is not accepted`, `use only: ${allowed.join(', ')}`);
    }
  }
  return value;
}

function optionalText(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value === '') {
    return bad('invalid-field', `${key} must be a non-empty string`, `give ${key} a value, or leave it out`);
  }
  return value;
}

export interface LaunchRequest {
  hostKind: HostKind;
  cwd: string;
  model?: string;
  permissionMode?: string;
  name?: string;
  /** stream-json only: the session id of the session to fork (a copy of its history continues under a new id, the source stays untouched). */
  forkOf?: string;
  /** Needs forkOf: the uuid of the transcript entry the fork stops at (a thread). */
  resumeSessionAt?: string;
  /** Needs resumeSessionAt: a one-line quote of the message (at most MAX_QUOTE_CHARS), kept in the record for the chip of the thread. */
  forkedAtQuote?: string;
}

/** The working directory: an absolute path of an existing folder (a relative one would be read against the daemon, not the caller). */
export async function assertWorkingDirectory(cwd: unknown): Promise<string> {
  if (typeof cwd !== 'string' || cwd === '') {
    return bad('cwd-missing-field', 'cwd is required', 'pass the absolute path of the project folder');
  }
  if (cwd.length > MAX_CWD_CHARS || /[\0\r\n]/.test(cwd)) {
    return bad('invalid-cwd', `cwd is not a single-line path of at most ${MAX_CWD_CHARS} characters`, 'pass the absolute path of the project folder');
  }
  if (!isAbsolute(cwd)) {
    return bad('cwd-not-absolute', `the working directory ${JSON.stringify(cwd)} is not an absolute path`, 'pass the absolute path of the project folder (a relative path would be resolved against the daemon, not against you)');
  }
  try {
    if (!(await stat(cwd)).isDirectory()) {
      return bad('cwd-not-a-folder', `the working directory ${cwd} is not a folder`, 'pass the path of an existing project folder');
    }
  } catch (error) {
    if (error instanceof LaunchError) {
      throw error;
    }
    return bad('cwd-missing', `the working directory ${cwd} cannot be used (${getErrorMessage(error)})`, 'create the folder or pass the path of an existing project folder');
  }
  return cwd;
}

export async function parseLaunchBody(value: unknown): Promise<LaunchRequest> {
  const body = objectBody(value, ['hostKind', 'cwd', 'model', 'permissionMode', 'name', 'forkOf', 'resumeSessionAt', 'forkedAtQuote'], '{"hostKind":"stream-json","cwd":"<absolute folder>"}');
  const hostKind = body['hostKind'];
  if (!HOST_KINDS.some((kind) => kind === hostKind)) {
    return bad('invalid-host-kind', `hostKind ${JSON.stringify(hostKind)} is not valid`, `use one of ${HOST_KINDS.join(', ')} ('stream-json' is owned by the daemon, 'hc' starts a herdr-core terminal, 'bg' starts a Claude Code background session)`);
  }
  const cwd = await assertWorkingDirectory(body['cwd']);
  const model = optionalText(body, 'model');
  if (model !== undefined) {
    assertModel(model);
  }
  const permissionMode = optionalText(body, 'permissionMode');
  if (permissionMode !== undefined) {
    assertPermissionMode(permissionMode);
  }
  const name = optionalText(body, 'name');
  if (name !== undefined && (name.length > MAX_NAME_CHARS || /[\u0000-\u001f\u007f]/.test(name))) {
    return bad('invalid-name', `name must be a single line of at most ${MAX_NAME_CHARS} characters`, 'use a short label without control characters (for hc: 1-32 of a-z 0-9 - _; for bg: not starting with "-")');
  }
  const forkOf = optionalText(body, 'forkOf');
  if (forkOf !== undefined) {
    if (hostKind !== 'stream-json') {
      return bad('fork-host-unsupported', `forkOf is not supported with hostKind ${JSON.stringify(hostKind)}`, "only 'stream-json' sessions can be forked (a bg or hc session cannot be started as a fork: no measurement proves it); use hostKind 'stream-json'");
    }
    assertForkSourceId(forkOf);
  }
  const resumeSessionAt = optionalText(body, 'resumeSessionAt');
  if (resumeSessionAt !== undefined) {
    if (forkOf === undefined) {
      return bad('resume-at-without-fork', 'resumeSessionAt was given without forkOf', 'pass forkOf (the session to branch from): without a fork the session would be resumed in place, not branched');
    }
    assertResumeSessionAt(resumeSessionAt);
  }
  const forkedAtQuote = optionalText(body, 'forkedAtQuote');
  if (forkedAtQuote !== undefined) {
    if (resumeSessionAt === undefined) {
      return bad('quote-without-anchor', 'forkedAtQuote was given without resumeSessionAt', 'pass resumeSessionAt (the message the thread stops at), or leave the quote out');
    }
    if (forkedAtQuote.length > MAX_QUOTE_CHARS || /[\u0000-\u001f\u007f]/.test(forkedAtQuote)) {
      return bad('invalid-quote', `forkedAtQuote must be a single line of at most ${MAX_QUOTE_CHARS} characters`, `cut the quote of the message to ${MAX_QUOTE_CHARS} characters and remove line breaks`);
    }
  }
  return {
    hostKind: hostKind as HostKind,
    cwd,
    ...(model === undefined ? {} : { model }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(name === undefined ? {} : { name }),
    ...(forkOf === undefined ? {} : { forkOf: forkOf.toLowerCase() }),
    ...(resumeSessionAt === undefined ? {} : { resumeSessionAt: resumeSessionAt.toLowerCase() }),
    ...(forkedAtQuote === undefined ? {} : { forkedAtQuote }),
  };
}

export interface SwitchRequest {
  /** The host the session moves to: 'stream-json' (Web, owned by the daemon) or 'hc' (a herdr-core terminal). */
  target: 'stream-json' | 'hc';
  /** True only after the user confirmed the reasons the session is not free to move (something runs). */
  force: boolean;
}

/** The body of a switch: the target host and, after a confirmation, force. A bg target is refused (not built yet). */
export function parseSwitchBody(value: unknown): SwitchRequest {
  const body = objectBody(value, ['target', 'force'], '{"target":"hc"}');
  const target = body['target'];
  if (target === undefined) {
    return bad('invalid-field', 'target is required', 'send {"target":"hc"} or {"target":"stream-json"}');
  }
  if (target !== 'stream-json' && target !== 'hc') {
    return bad('invalid-switch-target', `the target ${JSON.stringify(target)} is not valid`, "use 'stream-json' (Web) or 'hc' (a herdr-core terminal); moving to or from a background session is not supported yet");
  }
  const force = body['force'];
  if (force !== undefined && typeof force !== 'boolean') {
    return bad('invalid-field', 'force must be true or false', 'send force: true only after the user confirmed what is running, or leave it out');
  }
  return { target, force: force === true };
}

export interface SendRequest {
  text: string;
  images: ImageInput[];
}

/** The size of the bytes behind a base64 string (padding counted). */
function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function parseSendBody(value: unknown): SendRequest {
  const body = objectBody(value, ['text', 'images'], '{"text":"..."}');
  const text = body['text'];
  if (text !== undefined && typeof text !== 'string') {
    return bad('invalid-field', 'text must be a string', 'send the message as a string');
  }
  if (typeof text === 'string' && text.length > MAX_TEXT_CHARS) {
    return bad('text-too-long', `the text has ${text.length} characters, the limit is ${MAX_TEXT_CHARS}`, 'shorten the message, or put the long part in a file and send its path');
  }
  const rawImages = body['images'] ?? [];
  if (!Array.isArray(rawImages) || rawImages.length > MAX_IMAGES) {
    return bad('invalid-images', `images must be an array of at most ${MAX_IMAGES} images`, 'each image is {"mediaType":"image/png","dataBase64":"..."}');
  }
  let total = 0;
  const images = rawImages.map((raw: unknown, index): ImageInput => {
    if (!isRecord(raw) || typeof raw['mediaType'] !== 'string' || typeof raw['dataBase64'] !== 'string') {
      return bad('invalid-images', `images[${index}] is not {"mediaType":"image/png","dataBase64":"..."}`, 'give each image a mediaType and its bytes as plain base64 (no "data:" prefix)');
    }
    const { mediaType, dataBase64 } = raw;
    if (dataBase64 === '' || !BASE64.test(dataBase64)) {
      return bad('invalid-images', `images[${index}].dataBase64 is not base64`, 'pass the bytes as plain base64, without a "data:" prefix');
    }
    const bytes = decodedBytes(dataBase64);
    total += bytes;
    if (total > MAX_UPLOAD_BYTES) {
      return bad('image-too-large', `the images are ${total} bytes together (decoded), the limit is ${MAX_UPLOAD_BYTES}`, 'downscale or re-encode the image (JPEG), or send fewer images');
    }
    // The type comes from the first bytes; the declared type must agree (same rule as the reply uploads).
    const ext = detectImageExt(Buffer.from(dataBase64.slice(0, 64), 'base64'));
    if (ext === undefined) {
      return bad('invalid-images', `images[${index}] is not a png, jpeg, gif or webp image`, 'attach an image file of one of these types');
    }
    if (MIME_BY_EXT[ext] !== mediaType) {
      return bad('mime-mismatch', `images[${index}] declares ${JSON.stringify(mediaType)} but its content is ${MIME_BY_EXT[ext]}`, `declare ${MIME_BY_EXT[ext]}`);
    }
    return { mediaType, dataBase64 };
  });
  if ((text ?? '').trim() === '' && images.length === 0) {
    return bad('empty-message', 'the message has no text and no image', 'send {"text":"..."} or at least one image');
  }
  return { text: text ?? '', images };
}

export function parsePermissionModeBody(value: unknown): { mode: string } {
  const body = objectBody(value, ['mode'], '{"mode":"acceptEdits"}');
  const mode = body['mode'];
  if (typeof mode !== 'string' || mode === '') {
    return bad('invalid-field', 'mode is required', 'send {"mode":"default"} (or acceptEdits, plan, auto)');
  }
  assertPermissionMode(mode);
  return { mode };
}

export interface DecisionRequest {
  decision: 'allow' | 'deny';
  message: string;
}

export function parseDecisionBody(value: unknown): DecisionRequest {
  const body = objectBody(value, ['decision', 'message'], '{"decision":"allow"} or {"decision":"deny","message":"why"}');
  const decision = body['decision'];
  if (decision !== 'allow' && decision !== 'deny') {
    return bad('invalid-decision', `decision ${JSON.stringify(decision)} is not valid`, 'use "allow" or "deny"');
  }
  const message = body['message'];
  if (message !== undefined && (typeof message !== 'string' || message.trim() === '' || message.length > MAX_DENY_MESSAGE_CHARS)) {
    return bad('invalid-field', `message must be a non-empty string of at most ${MAX_DENY_MESSAGE_CHARS} characters`, 'give the model a short reason, or leave message out to use the default');
  }
  if (decision === 'allow' && message !== undefined) {
    return bad('invalid-field', 'message is only used with "deny"', 'remove message, or use {"decision":"deny","message":"..."}');
  }
  return { decision, message: typeof message === 'string' ? message : DEFAULT_DENY_MESSAGE };
}
