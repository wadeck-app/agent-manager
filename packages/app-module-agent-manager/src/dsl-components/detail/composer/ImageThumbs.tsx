import { X } from 'lucide-react';
import { FOCUS_RING } from '../deps.js';
import { Tooltip } from '../deps.js';
import { formatBytes } from './limits.js';
import { Thumb } from './Thumb.js';
import type { AttachedImage } from './types.js';

/** The attached images as thumbnails with their size and a remove button; a downscaled one says so in its tooltip. */
export function ImageThumbs({ images, onRemove, disabled }: { images: readonly AttachedImage[]; onRemove: (id: string) => void; disabled: boolean }) {
  if (images.length === 0) {
    return null;
  }
  return (
    <ul aria-label="Attached images" className="flex flex-wrap gap-2">
      {images.map((image) => (
        <li key={image.id} className="relative w-20">
          <Tooltip content={image.note === undefined ? image.name : `${image.name}. ${image.note}`}>
            <span className="inline-flex">
              <Thumb image={image} />
            </span>
          </Tooltip>
          <button
            type="button"
            aria-label={`Remove ${image.name}`}
            disabled={disabled}
            onClick={() => onRemove(image.id)}
            className={`absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-muted hover:text-content disabled:opacity-50 ${FOCUS_RING}`}
          >
            <X aria-hidden="true" className="h-3 w-3" />
          </button>
          <div className="mt-0.5 truncate text-xs tabular-nums text-muted">
            {formatBytes(image.bytes)}
            {image.note === undefined ? '' : ' (shrunk)'}
          </div>
        </li>
      ))}
    </ul>
  );
}
