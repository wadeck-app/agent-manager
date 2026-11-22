import { createHash } from 'node:crypto';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { FONT_DATA, FONT_SOURCE } from './fontFiles.generated.js';

/** The files the stylesheet (styles/agents.css) loads from `/api/modules/agent-manager/fonts/<file>`. The name carries the font version, so the answer never changes. */
export const FONT_FILES: Record<string, keyof typeof FONT_DATA> = {
  [`geist-${FONT_SOURCE.version}.woff2`]: 'geist',
  [`geist-mono-${FONT_SOURCE.version}.woff2`]: 'geist-mono',
};

interface FontReply {
  code(status: number): FontReply;
  header(name: string, value: string): FontReply;
  send(body: unknown): unknown;
}

/** Serves the embedded fonts (GET /fonts/:file). The CSP allows `font-src 'self'` only: no other origin, no data: URL. */
export function registerFontRoutes(ctx: ModuleContext): void {
  const buffers = new Map<string, Buffer>();
  for (const [file, key] of Object.entries(FONT_FILES)) {
    const bytes = Buffer.from(FONT_DATA[key].base64, 'base64');
    // A corrupted embed must fail at load, not render a page with a silently wrong font.
    if (bytes.length !== FONT_DATA[key].bytes || createHash('sha256').update(bytes).digest('hex') !== FONT_DATA[key].sha256) {
      throw new Error(`The embedded font ${file} is corrupted (size or checksum differs from fontFiles.generated.ts). Regenerate it: npx tsx src/backend/fonts/embed-fonts.ts <extracted geist package>`);
    }
    buffers.set(file, bytes);
  }
  ctx.registerRoute('GET', '/fonts/:file', (req: unknown, reply: unknown) => {
    const { file } = (req as { params: { file: string } }).params;
    const out = reply as FontReply;
    const bytes = buffers.get(file);
    if (bytes === undefined) {
      return out.code(404).send({ error: `No font named "${file}"`, hint: `Available: ${[...buffers.keys()].join(', ')}` });
    }
    return out.code(200).header('Content-Type', 'font/woff2').header('Cache-Control', 'public, max-age=31536000, immutable').send(bytes);
  });
}
