import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import * as realFs from 'node:fs/promises';
import { ReplyError, assertSafeId } from './errors.js';
import type { ReplyFs } from './fsTypes.js';

/** Decoded size cap of one upload request (decision 32: app-core body limit 1 MiB, base64 adds a third). */
export const MAX_UPLOAD_BYTES = 700 * 1024;

export type ImageExt = 'png' | 'jpg' | 'gif' | 'webp';

const MIME_BY_EXT: Record<ImageExt, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const EXT_BY_MIME: Record<string, ImageExt> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** The image type from the first bytes, or undefined when it is not png, jpeg, gif or webp. */
export function detectImageExt(bytes: Uint8Array): ImageExt | undefined {
  const at = (offset: number, ...values: number[]): boolean => values.every((value, i) => bytes[offset + i] === value);
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'png';
  }
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) {
    return 'jpg';
  }
  // GIF87a or GIF89a
  if (bytes.length >= 6 && at(0, 0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return 'gif';
  }
  // RIFF....WEBP
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return 'webp';
  }
  return undefined;
}

export interface SaveUploadInput {
  configDir: string;
  sessionId: string;
  msgId: string;
  /** Position of the image in the reply, 0 to 99. */
  index: number;
  /** Plain base64 (no `data:` prefix). */
  base64: string;
  declaredMime?: string;
  fs?: ReplyFs;
}

export interface SavedUpload {
  /** Absolute path of the saved file. */
  path: string;
  size: number;
  mime: string;
}

function reject(code: string, reason: string, fix: string): never {
  throw new ReplyError(code, reason, fix);
}

/**
 * Saves one pasted image under `<configDir>/uploads/<sessionId>/<msgId>-<index>.<ext>`.
 * No part of the path is user text: sessionId and msgId must match a strict identifier pattern, the extension comes from the magic bytes,
 * and the final path is checked to stay inside the uploads folder. The write is atomic (temp file in the same folder, then rename).
 */
export async function saveUpload(input: SaveUploadInput): Promise<SavedUpload> {
  const fs = input.fs ?? realFs;
  assertSafeId('session id', input.sessionId);
  assertSafeId('message id', input.msgId);
  if (!Number.isInteger(input.index) || input.index < 0 || input.index > 99) {
    reject('invalid-index', `the image index must be an integer from 0 to 99, got ${String(input.index)}`, 'send at most 100 images per reply');
  }
  if (typeof input.base64 !== 'string' || input.base64 === '') {
    reject('empty-image', 'the image data is empty', 'attach a png, jpeg, gif or webp image');
  }
  const compact = input.base64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    reject('invalid-base64', 'the image data is not plain base64 (a data: prefix, a URL-safe alphabet or a bad length are refused)', 'send the base64 of the file bytes only, without the "data:image/...;base64," prefix');
  }
  // A cheap upper bound before decoding: 4 base64 characters carry at most 3 bytes.
  if ((compact.length / 4) * 3 - 2 > MAX_UPLOAD_BYTES) {
    reject('upload-too-large', `the image is larger than ${MAX_UPLOAD_BYTES} bytes decoded (${Math.floor(MAX_UPLOAD_BYTES / 1024)} KB)`, 'downscale or re-encode the image (JPEG) so that it is under 700 KB, then paste it again');
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length > MAX_UPLOAD_BYTES) {
    reject('upload-too-large', `the image is ${bytes.length} bytes decoded, the cap is ${MAX_UPLOAD_BYTES} bytes (${Math.floor(MAX_UPLOAD_BYTES / 1024)} KB)`, 'downscale or re-encode the image (JPEG) so that it is under 700 KB, then paste it again');
  }
  const ext = detectImageExt(bytes);
  if (ext === undefined) {
    reject('unsupported-image', 'the data is not a png, jpeg, gif or webp image (checked on the first bytes, not on the declared type)', 'attach a png, jpeg, gif or webp file');
  }
  if (input.declaredMime !== undefined) {
    const declaredExt = EXT_BY_MIME[input.declaredMime.toLowerCase()];
    if (declaredExt !== ext) {
      reject('mime-mismatch', `the declared type ${JSON.stringify(input.declaredMime)} does not match the content, which is ${MIME_BY_EXT[ext]}`, 'attach the file again; do not rename files to another type');
    }
  }

  const base = resolve(input.configDir, 'uploads');
  const folder = join(base, input.sessionId);
  const finalPath = join(folder, `${input.msgId}-${input.index}.${ext}`);
  const outside = relative(base, finalPath);
  if (outside.startsWith('..') || isAbsolute(outside)) {
    reject('path-escape', 'the upload path leaves the uploads folder', 'report this: the identifier checks should make it impossible');
  }
  await fs.mkdir(dirname(finalPath), { recursive: true });
  const temp = `${finalPath}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, bytes, { flag: 'wx' });
    await fs.rename(temp, finalPath);
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw error;
  }
  return { path: finalPath, size: bytes.length, mime: MIME_BY_EXT[ext] };
}
