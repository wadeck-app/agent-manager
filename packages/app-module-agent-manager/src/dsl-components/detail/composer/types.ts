import type { SessionRowDto } from '../deps.js';
import type { Reencode } from './imagePipeline.js';

/** An image attached to the message being written. `dataBase64` is what POST /reply gets; `bytes` is the decoded size. */
export interface AttachedImage {
  id: string;
  name: string;
  mime: string;
  dataBase64: string;
  bytes: number;
  /** Set when the composer changed the file (downscaled): shown under the thumbnail. */
  note?: string;
}

/** The limits the server announced (GET reply/status), the only source: the composer waits for them before it accepts a file. */
export interface ComposerLimits {
  maxTextChars: number;
  maxImages: number;
  maxImageBytes: number;
  maxBodyBytes: number;
}

export interface ComposerProps {
  session: SessionRowDto;
  /** Tests replace the canvas re-encoding (jsdom has none). */
  reencode?: Reencode;
}
