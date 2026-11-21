import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_TEXT_CHARS } from '../../reply/compose.js';
import { MAX_UPLOAD_BYTES } from '../../reply/uploads.js';
import { removeDir } from '../../testFixtures.js';
import { LaunchError } from '../errors.js';
import { DEFAULT_DENY_MESSAGE, MAX_IMAGES, parseDecisionBody, parseLaunchBody, parsePermissionModeBody, parseSendBody } from './validation.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-validation-'));
  dirs.push(dir);
  return dir;
}

function error(work: () => unknown): LaunchError {
  try {
    work();
  } catch (caught) {
    if (caught instanceof LaunchError) {
      return caught;
    }
    throw caught;
  }
  throw new Error('expected a LaunchError');
}

async function asyncError(work: Promise<unknown>): Promise<LaunchError> {
  try {
    await work;
  } catch (caught) {
    if (caught instanceof LaunchError) {
      return caught;
    }
    throw caught;
  }
  throw new Error('expected a LaunchError');
}

/** The first bytes of each image type, base64 (enough for the magic-byte check). */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).toString('base64');

describe('parseLaunchBody', () => {
  it('accepts the documented fields', async () => {
    const cwd = folder();
    expect(await parseLaunchBody({ hostKind: 'stream-json', cwd, model: 'haiku', permissionMode: 'default', name: 'a label' })).toEqual({ hostKind: 'stream-json', cwd, model: 'haiku', permissionMode: 'default', name: 'a label' });
    expect(await parseLaunchBody({ hostKind: 'hc', cwd })).toEqual({ hostKind: 'hc', cwd });
    expect(await parseLaunchBody({ hostKind: 'bg', cwd })).toEqual({ hostKind: 'bg', cwd });
  });

  it.each([
    ['a body that is not an object', [], 'invalid-body'],
    ['an unknown field', { hostKind: 'hc', cwd: '', extra: 1 }, 'unknown-field'],
    ['a missing host kind', {}, 'invalid-host-kind'],
    ['an unknown host kind', { hostKind: 'x' }, 'invalid-host-kind'],
  ])('refuses %s', async (_name, body, code) => {
    expect((await asyncError(parseLaunchBody(body))).code).toBe(code);
  });

  it('refuses a missing, relative, unreadable or non-folder cwd with a fix', async () => {
    const dir = folder();
    const file = join(dir, 'file.txt');
    writeFileSync(file, 'x');
    expect((await asyncError(parseLaunchBody({ hostKind: 'hc' }))).code).toBe('cwd-missing-field');
    const relative = await asyncError(parseLaunchBody({ hostKind: 'hc', cwd: 'project' }));
    expect(relative.code).toBe('cwd-not-absolute');
    expect(relative.fix).toContain('absolute');
    expect((await asyncError(parseLaunchBody({ hostKind: 'hc', cwd: join(dir, 'nope') }))).code).toBe('cwd-missing');
    expect((await asyncError(parseLaunchBody({ hostKind: 'hc', cwd: file }))).code).toBe('cwd-not-a-folder');
    expect((await asyncError(parseLaunchBody({ hostKind: 'hc', cwd: `${dir}\nx` }))).code).toBe('invalid-cwd');
  });

  it('refuses a model or a permission mode that could become a flag, and a bad name', async () => {
    const cwd = folder();
    expect((await asyncError(parseLaunchBody({ hostKind: 'hc', cwd, model: '--dangerously-skip-permissions' }))).code).toBe('invalid-model');
    expect((await asyncError(parseLaunchBody({ hostKind: 'hc', cwd, permissionMode: 'default --force' }))).code).toBe('invalid-permission-mode');
    expect((await asyncError(parseLaunchBody({ hostKind: 'hc', cwd, name: 'a\nb' }))).code).toBe('invalid-name');
    expect((await asyncError(parseLaunchBody({ hostKind: 'hc', cwd, model: '' }))).code).toBe('invalid-field');
  });
});

describe('parseSendBody', () => {
  it('accepts text and images', () => {
    expect(parseSendBody({ text: 'hi' })).toEqual({ text: 'hi', images: [] });
    expect(parseSendBody({ text: 'look', images: [{ mediaType: 'image/png', dataBase64: PNG }] }).images).toHaveLength(1);
    expect(parseSendBody({ images: [{ mediaType: 'image/jpeg', dataBase64: JPEG }] }).text).toBe('');
  });

  it.each([
    ['an empty message', {}, 'empty-message'],
    ['a blank text without images', { text: '  ' }, 'empty-message'],
    ['a text that is not a string', { text: 1 }, 'invalid-field'],
    ['an unknown field', { text: 'x', priority: 'now' }, 'unknown-field'],
    ['a text over the limit', { text: 'x'.repeat(MAX_TEXT_CHARS + 1) }, 'text-too-long'],
    ['too many images', { text: 'x', images: Array.from({ length: MAX_IMAGES + 1 }, () => ({ mediaType: 'image/png', dataBase64: PNG })) }, 'invalid-images'],
    ['an image that is not an object', { text: 'x', images: [1] }, 'invalid-images'],
    ['an image that is not base64', { text: 'x', images: [{ mediaType: 'image/png', dataBase64: 'data:image/png;base64,AAAA' }] }, 'invalid-images'],
    ['an image with unknown content', { text: 'x', images: [{ mediaType: 'image/png', dataBase64: Buffer.from('not an image at all').toString('base64') }] }, 'invalid-images'],
    ['an image whose type differs from its content', { text: 'x', images: [{ mediaType: 'image/jpeg', dataBase64: PNG }] }, 'mime-mismatch'],
  ])('refuses %s', (_name, body, code) => {
    expect(error(() => parseSendBody(body)).code).toBe(code);
  });

  it('refuses images above the decoded size limit, saying how to fix it', () => {
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(MAX_UPLOAD_BYTES)]).toString('base64');
    const failure = error(() => parseSendBody({ text: 'x', images: [{ mediaType: 'image/png', dataBase64: big }] }));
    expect(failure.code).toBe('image-too-large');
    expect(failure.fix).toContain('downscale');
  });
});

describe('parseLaunchBody forkOf', () => {
  const source = '11111111-2222-4333-8444-555555555555';

  it('accepts the id of the session to fork for a stream-json launch (lower-cased)', async () => {
    const request = await parseLaunchBody({ hostKind: 'stream-json', cwd: folder(), forkOf: source.toUpperCase(), name: 'fork of x' });
    expect(request).toMatchObject({ hostKind: 'stream-json', forkOf: source, name: 'fork of x' });
  });

  it('refuses forkOf for hc and bg (nothing proves it there), and a source that is not a UUID, each with a fix', async () => {
    for (const hostKind of ['hc', 'bg']) {
      const failure = await asyncError(parseLaunchBody({ hostKind, cwd: folder(), forkOf: source }));
      expect(failure.code).toBe('fork-host-unsupported');
      expect(failure.fix).toContain('stream-json');
    }
    const badId = await asyncError(parseLaunchBody({ hostKind: 'stream-json', cwd: folder(), forkOf: '../../x' }));
    expect(badId.code).toBe('invalid-fork-source');
    expect(badId.fix).not.toBe('');
    expect((await asyncError(parseLaunchBody({ hostKind: 'stream-json', cwd: folder(), forkOf: '' }))).code).toBe('invalid-field');
  });
});

describe('permission bodies', () => {
  it('accepts a mode and refuses anything that is not a single word', () => {
    expect(parsePermissionModeBody({ mode: 'acceptEdits' })).toEqual({ mode: 'acceptEdits' });
    expect(error(() => parsePermissionModeBody({})).code).toBe('invalid-field');
    expect(error(() => parsePermissionModeBody({ mode: '--x' })).code).toBe('invalid-permission-mode');
    expect(error(() => parsePermissionModeBody({ mode: 'plan', extra: 1 })).code).toBe('unknown-field');
  });

  it('accepts allow, and deny with a message or the default one', () => {
    expect(parseDecisionBody({ decision: 'allow' })).toEqual({ decision: 'allow', message: DEFAULT_DENY_MESSAGE });
    expect(parseDecisionBody({ decision: 'deny', message: 'too risky' })).toEqual({ decision: 'deny', message: 'too risky' });
    expect(parseDecisionBody({ decision: 'deny' }).message).toBe(DEFAULT_DENY_MESSAGE);
  });

  it.each([
    ['an unknown decision', { decision: 'maybe' }],
    ['no decision', {}],
    ['an empty deny message', { decision: 'deny', message: ' ' }],
    ['a message with allow', { decision: 'allow', message: 'why' }],
    ['a number as message', { decision: 'deny', message: 5 }],
  ])('refuses %s', (_name, body) => {
    expect(error(() => parseDecisionBody(body)).fix).not.toBe('');
  });
});
