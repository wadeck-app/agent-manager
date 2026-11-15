import type { AttachedImage, ComposerLimits } from './types.js';

/** Base64 length of `bytes` bytes. */
export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const encoder = new TextEncoder();

/** Size in bytes of the JSON request body for this text and these images (what app-core counts against its 1 MiB cap). */
export function requestBodyBytes(text: string, images: readonly Pick<AttachedImage, 'name' | 'mime' | 'dataBase64'>[]): number {
  const envelope = JSON.stringify({
    text,
    images: images.map((image) => ({ name: image.name, mime: image.mime, dataBase64: '' })),
    priority: 'now',
    confirmNow: true,
    messageId: 'x'.repeat(40),
  });
  return encoder.encode(envelope).length + images.reduce((sum, image) => sum + image.dataBase64.length, 0);
}

/** Decoded bytes a new image may still use so the whole body stays under the cap (3/4 of the room left, base64 adds a third). */
export function imageBudget(text: string, images: readonly AttachedImage[], limits: ComposerLimits): number {
  const room = limits.maxBodyBytes - requestBodyBytes(text, images);
  return Math.max(0, Math.min(limits.maxImageBytes, Math.floor((room * 3) / 4) - 1024));
}

/** Why this message cannot be sent, as one actionable sentence; undefined when it can. */
export function sendProblem(text: string, images: readonly AttachedImage[], limits: ComposerLimits): string | undefined {
  if (text.trim() === '' && images.length === 0) {
    return 'Type a message or attach an image.';
  }
  if (text.length > limits.maxTextChars) {
    return `The message has ${text.length} characters, the limit is ${limits.maxTextChars}. Shorten it by ${text.length - limits.maxTextChars} characters.`;
  }
  if (images.length > limits.maxImages) {
    return `${images.length} images attached, the limit is ${limits.maxImages}. Remove ${images.length - limits.maxImages}.`;
  }
  const body = requestBodyBytes(text, images);
  if (body > limits.maxBodyBytes) {
    return `The request would be ${formatBytes(body)}, the limit is ${formatBytes(limits.maxBodyBytes)} (images grow by a third as base64). Remove an image or use a smaller one.`;
  }
  return undefined;
}
