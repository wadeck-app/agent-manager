import { getErrorMessage } from '../deps.js';
import { formatBytes } from './limits.js';
import type { AttachedImage } from './types.js';

export const ACCEPTED_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** Re-encodes an image as JPEG, at most `maxSide` pixels on the long side. Behind a function so tests replace it (jsdom has no canvas). */
export type Reencode = (file: Blob, maxSide: number, quality: number) => Promise<Blob>;

export const reencodeWithCanvas: Reencode = async (file, maxSide, quality) => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('the browser gave no 2D canvas');
  }
  // JPEG has no transparency: paint a white background first, else transparent pixels turn black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob === null ? reject(new Error('the browser could not encode the image')) : resolve(blob)), 'image/jpeg', quality));
};

const STEPS: readonly (readonly [number, number])[] = [
  [2400, 0.85],
  [1800, 0.8],
  [1400, 0.7],
  [1000, 0.6],
  [700, 0.5],
];

export function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(reader.error?.message ?? 'the file could not be read'));
    reader.onload = () => {
      const text = String(reader.result);
      resolve(text.slice(text.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export type PrepareResult = { ok: true; image: AttachedImage } | { ok: false; message: string };

let counter = 0;

/**
 * Turns a file into an attachment that fits `budget` decoded bytes. A file over the budget is re-encoded smaller (JPEG, steps of size and quality) and the
 * attachment says so in `note`; one that cannot get small enough, or that is not a supported image, is refused with what to do.
 */
export async function prepareImage(file: File, budget: number, reencode: Reencode = reencodeWithCanvas): Promise<PrepareResult> {
  const name = file.name === '' ? `pasted-${Date.now()}.${file.type.split('/')[1] ?? 'png'}` : file.name;
  if (!(ACCEPTED_MIMES as readonly string[]).includes(file.type)) {
    return { ok: false, message: `${name} is ${file.type === '' ? 'of an unknown type' : file.type}: only PNG, JPEG, GIF and WebP images can be sent. Convert it, then attach it again.` };
  }
  counter += 1;
  const id = `img-${Date.now()}-${counter}`;
  if (file.size <= budget) {
    return { ok: true, image: { id, name, mime: file.type, dataBase64: await readBase64(file), bytes: file.size } };
  }
  if (budget < 20 * 1024) {
    return { ok: false, message: `${name} (${formatBytes(file.size)}) does not fit: the message already uses almost all of its size limit. Remove an image or send it in a second message.` };
  }
  if (file.type === 'image/gif') {
    return { ok: false, message: `${name} is a ${formatBytes(file.size)} GIF, over the ${formatBytes(budget)} left, and a GIF cannot be shrunk here without losing its animation. Use a smaller GIF or a PNG screenshot.` };
  }
  let failure = '';
  for (const [side, quality] of STEPS) {
    let blob: Blob;
    try {
      blob = await reencode(file, side, quality);
    } catch (error) {
      failure = getErrorMessage(error);
      break;
    }
    if (blob.size <= budget) {
      const shrunk = `${name.replace(/\.[^.]+$/, '')}.jpg`;
      return {
        ok: true,
        image: {
          id,
          name: shrunk,
          mime: 'image/jpeg',
          dataBase64: await readBase64(blob),
          bytes: blob.size,
          note: `Shrunk from ${formatBytes(file.size)} to ${formatBytes(blob.size)} (JPEG, longest side ${side} px) to fit the limit.`,
        },
      };
    }
  }
  const why = failure === '' ? `even at the smallest size it stays over ${formatBytes(budget)}` : `re-encoding failed (${failure})`;
  return { ok: false, message: `${name} (${formatBytes(file.size)}) is too large and ${why}. Crop it or take a smaller screenshot.` };
}
