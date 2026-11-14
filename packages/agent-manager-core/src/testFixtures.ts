import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Test-only (excluded from the build). A registry file as Claude Code writes it, with the fields observed on a real machine. */
export function registryEntry(pid: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pid,
    sessionId: `00000000-0000-4000-8000-${String(pid).padStart(12, '0')}`,
    cwd: '/work/shop',
    startedAt: 1_000_000,
    procStart: '134390780115574227',
    version: '2.1.323',
    peerProtocol: 1,
    peerFeatures: ['notify_idle'],
    kind: 'interactive',
    entrypoint: 'cli',
    pidDomain: 'win32:test',
    asksForConvertedSkills: null,
    messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-test',
    name: 'shop-owner',
    nameSource: 'user',
    status: 'idle',
    updatedAt: 1_005_000,
    statusUpdatedAt: 1_004_000,
    ...overrides,
  };
}

/** A fresh temp folder holding the given files (name -> text, objects are written as JSON). Remove it with `removeDir`. */
export function makeRegistryDir(files: Record<string, string | Record<string, unknown>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-registry-'));
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

/** The pid of a process that existed and has ended: a short-lived child of this test run (real, not invented, so the real probe is exercised). */
export function deadPid(): number {
  const child = spawnSync(process.execPath, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (child.pid === undefined || child.status !== 0) {
    throw new Error(`cannot start a short-lived process to get a dead pid: ${String(child.error ?? child.stderr)}`);
  }
  return child.pid;
}
