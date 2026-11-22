import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { FONT_FILES, registerFontRoutes } from './fontRoutes.js';

function serve(file: string) {
  let handler: ((req: unknown, reply: unknown) => unknown) | undefined;
  let registered = '';
  const ctx = {
    registerRoute: (method: string, subPath: string, h: typeof handler) => {
      registered = `${method} ${subPath}`;
      handler = h;
    },
  } as unknown as ModuleContext;
  registerFontRoutes(ctx);
  const answer: { status?: number; headers: Record<string, string>; body?: unknown } = { headers: {} };
  const reply = {
    code(status: number) {
      answer.status = status;
      return reply;
    },
    header(name: string, value: string) {
      answer.headers[name] = value;
      return reply;
    },
    send(body: unknown) {
      answer.body = body;
      return reply;
    },
  };
  handler?.({ params: { file } }, reply);
  return { registered, answer };
}

describe('the font routes', () => {
  it('serve every embedded font as woff2 with a long cache (the file name carries the version)', () => {
    for (const file of Object.keys(FONT_FILES)) {
      const { registered, answer } = serve(file);
      expect(registered).toBe('GET /fonts/:file');
      expect(answer.status).toBe(200);
      expect(answer.headers['Content-Type']).toBe('font/woff2');
      expect(answer.headers['Cache-Control']).toContain('immutable');
      const bytes = answer.body as Buffer;
      // The woff2 signature.
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
      expect(bytes.length).toBeGreaterThan(30_000);
    }
  });

  it('answer an unknown name with a 404 that lists the available files', () => {
    const { answer } = serve('nope.woff2');
    expect(answer.status).toBe(404);
    expect(JSON.stringify(answer.body)).toContain('geist-');
  });
});

describe('the stylesheet', () => {
  it('loads exactly the files the route serves, scoped by data-font, with a swap and a fallback stack', () => {
    const css = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'dsl-components', 'styles', 'agents.css'), 'utf8');
    const urls = [...css.matchAll(/url\('\/api\/modules\/agent-manager\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
    expect(urls.sort()).toEqual(Object.keys(FONT_FILES).sort());
    expect(css.match(/font-display: swap;/g)).toHaveLength(2);
    expect(css).toMatch(/\.agents-scope\[data-font='geist'\][^{]*\{\s*font-family: 'AM Geist', ui-sans-serif/);
    expect(css).toMatch(/\.agents-scope\[data-font='geist-mono'\] \.font-mono \{\s*font-family: 'AM Geist Mono', ui-monospace/);
  });
});
