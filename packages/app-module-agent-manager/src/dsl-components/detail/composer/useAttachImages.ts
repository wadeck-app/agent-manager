import { useCallback, useRef } from 'react';
import { prepareImage, type Reencode, reencodeWithCanvas } from './imagePipeline.js';
import { imageBudget } from './limits.js';
import type { AttachedImage, ComposerLimits } from './types.js';

export interface AttachArgs {
  /** The text and images NOW (read at each step: several attaches, a send or a remove may run meanwhile; never a snapshot of the render that started the attach). */
  getCurrent: () => { text: string; images: readonly AttachedImage[] };
  /** Appends one image to the images as they are now (a functional update). False when there is no room left any more: nothing was added. */
  addImage: (image: AttachedImage, maxImages: number) => boolean;
  /** Undefined until the server announced them: files are refused with a message meanwhile. */
  limits: ComposerLimits | undefined;
  /** What went wrong, one sentence each, with what to do. */
  onProblems: (messages: string[]) => void;
  /** What the composer did on its own (shrunk an image). */
  onNotes: (messages: string[]) => void;
  reencode?: Reencode;
}

/** Adds files (paste, drop, picker) one after the other: each must fit what the others left of the request, else it is shrunk or refused. */
export function useAttachImages(args: AttachArgs): (files: readonly File[]) => Promise<void> {
  const latest = useRef(args);
  latest.current = args;
  return useCallback(async (files: readonly File[]) => {
    const problems: string[] = [];
    const notes: string[] = [];
    for (const file of files) {
      const { limits, getCurrent, reencode } = latest.current;
      const label = file.name === '' ? 'the image' : file.name;
      if (limits === undefined) {
        problems.push('Images cannot be attached yet: the limits of the server are not known. Wait a moment and try again.');
        break;
      }
      const before = getCurrent();
      if (before.images.length >= limits.maxImages) {
        problems.push(`At most ${limits.maxImages} images per message: ${label} was not attached. Send this message first.`);
        continue;
      }
      const result = await prepareImage(file, imageBudget(before.text, before.images, limits), reencode ?? reencodeWithCanvas);
      if (!result.ok) {
        problems.push(result.message);
      } else if (latest.current.addImage(result.image, limits.maxImages)) {
        if (result.image.note !== undefined) {
          notes.push(`${result.image.name}: ${result.image.note}`);
        }
      } else {
        // Another attach filled the message while this file was being decoded.
        problems.push(`At most ${limits.maxImages} images per message: ${label} was not attached. Send this message first.`);
      }
    }
    latest.current.onProblems(problems);
    latest.current.onNotes(notes);
  }, []);
}
