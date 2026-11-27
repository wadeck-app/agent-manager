import { ImageOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AttachedImage } from './types.js';

const THUMB_PLACEHOLDER = 'flex h-14 w-20 items-center justify-center rounded border border-border bg-muted-bg text-muted';

const WIDTH = 80;
const HEIGHT = 56;

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * The preview of an attached image, drawn on a canvas. An <img> with a data: or blob: URL would be blocked by the page's content-security policy
 * (img-src 'self': the server log says `[csp] blocked "data" (img-src)`), a canvas drawn from decoded bytes is not. When the browser cannot decode
 * the file, an icon with the name says so instead of a broken image.
 */
export function Thumb({ image }: { image: AttachedImage }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(typeof createImageBitmap === 'undefined');

  useEffect(() => {
    if (typeof createImageBitmap === 'undefined') {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const bitmap = await createImageBitmap(new Blob([bytesOf(image.dataBase64)], { type: image.mime }));
        const context = canvas.current?.getContext('2d');
        if (cancelled || context === null || context === undefined) {
          bitmap.close();
          return;
        }
        // "cover": fill the box, centred, cropping the overflow.
        const scale = Math.max(WIDTH / bitmap.width, HEIGHT / bitmap.height);
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        context.drawImage(bitmap, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
        bitmap.close();
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [image.dataBase64, image.mime]);

  if (failed) {
    return (
      <span role="img" aria-label={image.name} className={THUMB_PLACEHOLDER}>
        <ImageOff aria-hidden="true" className="h-am-icon w-am-icon" />
      </span>
    );
  }
  return <canvas ref={canvas} role="img" aria-label={image.name} width={WIDTH} height={HEIGHT} className="h-14 w-20 rounded border border-border bg-muted-bg" />;
}
