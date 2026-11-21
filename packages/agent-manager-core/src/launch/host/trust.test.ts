import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir } from '../../testFixtures.js';
import { checkFolderTrust } from './trust.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

function claudeJson(projects: Record<string, unknown> | string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-trust-'));
  dirs.push(dir);
  const file = join(dir, '.claude.json');
  if (projects !== undefined) {
    writeFileSync(file, typeof projects === 'string' ? projects : JSON.stringify({ projects }));
  }
  return file;
}

describe('checkFolderTrust (the trust dialog of an interactive claude blocks an untrusted folder, measured a9)', () => {
  it('trusted when the folder has hasTrustDialogAccepted (the key uses forward slashes, as Claude Code writes it)', async () => {
    // violations-suppress: shared/no-out-of-repo-path a path as a plain test input (a claude.json is written in a temp folder), never read from disk
    const file = claudeJson({ 'C:/work/shop': { hasTrustDialogAccepted: true } });
    // violations-suppress: shared/no-out-of-repo-path a path as a plain test input (a claude.json is written in a temp folder), never read from disk
    expect(await checkFolderTrust('C:\\work\\shop', file)).toEqual({ trusted: true });
  });

  it('a parent folder that is trusted does NOT make the subfolder trusted: it is reported as inherited (not verified that Claude Code honours it)', async () => {
    // violations-suppress: shared/no-out-of-repo-path a path as a plain test input (a claude.json is written in a temp folder), never read from disk
    const file = claudeJson({ 'C:/work': { hasTrustDialogAccepted: true } });
    // violations-suppress: shared/no-out-of-repo-path a path as a plain test input (a claude.json is written in a temp folder), never read from disk
    const result = await checkFolderTrust('C:\\work\\shop\\api', file);
    // violations-suppress: shared/no-out-of-repo-path a path as a plain test input (an expected value), never read from disk
    expect(result).toMatchObject({ trusted: false, inherited: 'C:/work' });
    expect(!result.trusted && result.reason).toMatch(/not verified/);
    expect(!result.trusted && result.reason).toMatch(/Open claude once in the folder to trust it/);
  });

  it('not trusted: no entry, or an entry that is not accepted, with the one command that fixes it', async () => {
    // violations-suppress: shared/no-out-of-repo-path a path as a plain test input (a claude.json is written in a temp folder), never read from disk
    for (const projects of [{}, { 'C:/work/shop': { hasTrustDialogAccepted: false } }, { 'C:/work/shop': {} }]) {
      // violations-suppress: shared/no-out-of-repo-path a path as a plain test input (a claude.json is written in a temp folder), never read from disk
      const result = await checkFolderTrust('C:\\work\\shop', claudeJson(projects));
      expect(result.trusted).toBe(false);
      expect(!result.trusted && result.reason).toMatch(/not trusted/);
      expect(!result.trusted && result.reason).toMatch(/cd .*shop.*claude|claude.*C:\\work\\shop/s);
    }
  });

  it('a Claude Code config that is missing or unreadable is a refusal that names the file, never a silent yes', async () => {
    // violations-suppress: shared/no-out-of-repo-path a path as a plain test input (a claude.json is written in a temp folder), never read from disk
    const missing = await checkFolderTrust('C:\\work\\shop', claudeJson(undefined));
    expect(missing.trusted).toBe(false);
    expect(!missing.trusted && missing.reason).toContain('.claude.json');
    // violations-suppress: shared/no-out-of-repo-path a path as a plain test input (a claude.json is written in a temp folder), never read from disk
    const broken = await checkFolderTrust('C:\\work\\shop', claudeJson('{not json'));
    expect(broken.trusted).toBe(false);
    expect(!broken.trusted && broken.reason).toMatch(/not valid JSON|cannot be read/);
  });

  it('works for a POSIX path too', async () => {
    const file = claudeJson({ '/home/me/shop': { hasTrustDialogAccepted: true } });
    expect(await checkFolderTrust('/home/me/shop', file)).toEqual({ trusted: true });
    expect(await checkFolderTrust('/home/me/shop/api', file)).toMatchObject({ trusted: false, inherited: '/home/me/shop' });
  });
});
