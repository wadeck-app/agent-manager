import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach } from 'vitest';
import { clearDigestCache } from './transcriptDigest.js';
import { clearStatusCaches } from './sessionStatus.js';

/** Test-only: a sandbox (registry, projects, config and data folders in the temp folder) and builders of registry files and transcript lines. */

export const CWD = '/work/shop';
export const SLUG = '-work-shop';
export const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export interface Sandbox {
  registry: string;
  projects: string;
  config: string;
  data: string;
}

const VARIABLES = ['AGENT_MANAGER_SESSIONS_DIR', 'AGENT_MANAGER_PROJECTS_DIR', 'AGENT_MANAGER_CONFIG_DIR'] as const;

/** Registers beforeEach / afterEach hooks that point the module at fresh temp folders; the returned object is filled before each test. */
export function useSandbox(): Sandbox {
  const box = { registry: '', projects: '', config: '', data: '' };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'agent-manager-api-'));
    box.registry = join(root, 'registry');
    box.projects = join(root, 'projects');
    box.config = join(root, 'config');
    box.data = join(root, 'data');
    for (const dir of [box.registry, box.projects, box.config, box.data]) {
      mkdirSync(dir, { recursive: true });
    }
    for (const name of VARIABLES) {
      saved[name] = process.env[name];
    }
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = box.registry;
    process.env['AGENT_MANAGER_PROJECTS_DIR'] = box.projects;
    process.env['AGENT_MANAGER_CONFIG_DIR'] = box.config;
    clearDigestCache();
    clearStatusCaches();
  });
  afterEach(() => {
    for (const name of VARIABLES) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
    rmSync(join(box.registry, '..'), { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  return box;
}

/** A registry file for a live session (the pid is this process or its parent, so that it is alive). */
export function putSession(box: Sandbox, pid: number, fields: Record<string, unknown> = {}): string {
  const sessionId = ID(pid);
  writeFileSync(join(box.registry, `${pid}.json`), JSON.stringify({ pid, sessionId, cwd: CWD, version: '2.1.323', status: 'idle', statusUpdatedAt: Date.now() - 2 * 60_000, ...fields }));
  return sessionId;
}

/** The pid of a process that ended. */
export function deadPid(): number {
  const child = spawnSync(process.execPath, ['--version'], { windowsHide: true });
  if (child.pid === undefined) {
    throw new Error('cannot start a child process to get a dead pid');
  }
  return child.pid;
}

export function transcriptFile(box: Sandbox, sessionId: string): string {
  mkdirSync(join(box.projects, SLUG), { recursive: true });
  return join(box.projects, SLUG, `${sessionId}.jsonl`);
}

type Obj = Record<string, unknown>;
let counter = 0;
const uid = (): string => {
  counter += 1;
  return `10000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
};
/** ISO time `seconds` after a fixed start. */
export const ts = (seconds: number): string => new Date(Date.UTC(2026, 10, 15, 10, 0, 0) + seconds * 1000).toISOString();

export const userLine = (seconds: number, text: string): Obj => ({
  parentUuid: null,
  isSidechain: false,
  promptId: uid(),
  type: 'user',
  message: { role: 'user', content: text },
  uuid: uid(),
  timestamp: ts(seconds),
  userType: 'external',
  promptSource: 'typed',
  origin: { kind: 'human' },
  turnOrigin: 'human',
  cwd: CWD,
});

function assistant(seconds: number, messageId: string, block: Obj): Obj {
  return {
    parentUuid: uid(),
    isSidechain: false,
    message: { id: messageId, type: 'message', role: 'assistant', model: 'claude-test-1', content: [block], usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 } },
    type: 'assistant',
    uuid: uid(),
    timestamp: ts(seconds),
    userType: 'external',
    cwd: CWD,
  };
}

/** An assistant text line of the given model with the given usage (trimmed real shape: `message.model` has no region and no [1m] tag). */
export function modelLine(seconds: number, model: string, usage: { input?: number; cacheRead?: number; cacheCreate?: number; output?: number } = {}, text = 'ok'): Obj {
  const line = assistant(seconds, `msg_${uid()}`, { type: 'text', text });
  (line['message'] as Obj)['model'] = model;
  (line['message'] as Obj)['usage'] = {
    input_tokens: usage.input ?? 10,
    cache_creation_input_tokens: usage.cacheCreate ?? 100,
    cache_read_input_tokens: usage.cacheRead ?? 1000,
    output_tokens: usage.output ?? 50,
  };
  return line;
}

/** The `model` attachment in its real key order (the attachment object comes before the type). */
export const modelAttachmentLine = (seconds: number, modelId: string, marketingName: string): Obj => ({
  parentUuid: uid(),
  isSidechain: false,
  attachment: { type: 'model', identity: { modelId, marketingName, knowledgeCutoff: 'June 2026' } },
  type: 'attachment',
  uuid: uid(),
  timestamp: ts(seconds),
  userType: 'external',
  cwd: CWD,
});

/** The two user lines of a `/model` command: the command and its stdout (real shape, ANSI-free). */
export const modelCommandLines = (seconds: number, stdout: string): Obj[] => [
  userLine(seconds, '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args></command-args>'),
  userLine(seconds, `<local-command-stdout>${stdout}</local-command-stdout>`),
];

export const textLine = (seconds: number, text: string): Obj => assistant(seconds, `msg_${uid()}`, { type: 'text', text });
export const toolUseLine = (seconds: number, id: string, name: string, input: Obj): Obj => assistant(seconds, `msg_${uid()}`, { type: 'tool_use', id, name, input });
export const toolResultLine = (seconds: number, id: string, content: string): Obj => ({
  parentUuid: uid(),
  isSidechain: false,
  promptId: uid(),
  type: 'user',
  message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content }] },
  uuid: uid(),
  timestamp: ts(seconds),
  userType: 'external',
  cwd: CWD,
});

/** Writes (or appends) transcript lines. */
export function writeLines(file: string, lines: readonly Obj[], append = false): void {
  const text = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
  if (append) {
    appendFileSync(file, text);
  } else {
    writeFileSync(file, text);
  }
}
