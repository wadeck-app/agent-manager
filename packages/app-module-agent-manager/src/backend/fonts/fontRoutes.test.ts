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
      expect(bytes.length).toBeGreaterThan(15_000);
    }
  });

  it('answer an unknown name with a 404 that lists the available files', () => {
    const { answer } = serve('nope.woff2');
    expect(answer.status).toBe(404);
    expect(JSON.stringify(answer.body)).toContain('geist-');
    expect(JSON.stringify(answer.body)).toContain('jetbrains-mono-');
  });
});

describe('the stylesheet', () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'dsl-components', 'styles', 'agents.css'), 'utf8');

  it('loads exactly the files the route serves (Geist and JetBrains Mono), with a swap; the page font stays Geist on the scope wrapper', () => {
    const urls = [...css.matchAll(/url\('\/api\/modules\/agent-manager\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
    expect(urls.sort()).toEqual(Object.keys(FONT_FILES).sort());
    expect(css.match(/font-display: swap;/g)).toHaveLength(Object.keys(FONT_FILES).length);
    expect(css).toMatch(/\.agents-scope \{\s*font-family: 'AM Geist', ui-sans-serif/);
    expect(css).not.toContain('Geist Mono');
  });

  it('declares the weights and the italic the log renders under one family, applied only through the .am-log-font class', () => {
    for (const [weight, style] of [['400', 'normal'], ['500', 'normal'], ['700', 'normal'], ['400', 'italic']]) {
      const face = new RegExp(`font-family: 'AM JetBrains Mono';\\s+src: url\\('[^']+'\\) format\\('woff2'\\);\\s+font-weight: ${weight};\\s+font-style: ${style};`);
      expect(css, `@font-face ${weight} ${style}`).toMatch(face);
    }
    expect(css).toContain("--am-log-font: 'AM JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;");
    expect(css).toMatch(/\.agents-scope \.am-log-font,\s*\.agents-scope \.am-log-font \.font-mono \{\s*font-family: var\(--am-log-font\);/);
    // The wrapper rule of the page font never mentions the log font.
    const wrapper = css.match(/\.agents-scope \{\s*font-family:[^}]*\}/)?.[0] ?? '';
    expect(wrapper).not.toContain('JetBrains');
  });

  it('puts the class on the session log container only: no other component carries it', () => {
    const root = path.join(import.meta.dirname, '..', '..', 'dsl-components');
    const carriers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) && fs.readFileSync(full, 'utf8').includes('am-log-font')) {
          carriers.push(path.relative(root, full).replaceAll('\\', '/'));
        }
      }
    };
    walk(root);
    expect(carriers).toEqual(['detail/log/LogViewerBody.tsx']);
  });
});
