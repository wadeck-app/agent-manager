import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDir } from './testHelpers.js';

const sdk = vi.hoisted(() => ({
  registerModule: vi.fn(),
  unregisterModule: vi.fn(),
  describeRegistration: vi.fn(),
}));
vi.mock('@wadeck-app/app-core-sdk/register', () => sdk);

// The mocks keep their calls and answers between tests unless reset (this package does not turn mockReset on globally).
beforeEach(() => {
  vi.resetAllMocks();
});

// EXPLICIT isolation of the whole file (on top of the shared setup of the repository): attemptUnregistration removes the staged copies of the module in
// <config folder>/app-module, and this file once ran it against the real ~/.config/agent-manager, which broke the module in the user's real app-core.
let isolatedHome: string;
let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-manager-cli-registration-'));
  savedEnv = { AGENT_MANAGER_CONFIG_DIR: process.env['AGENT_MANAGER_CONFIG_DIR'], HOME: process.env['HOME'], USERPROFILE: process.env['USERPROFILE'] };
  process.env['AGENT_MANAGER_CONFIG_DIR'] = path.join(isolatedHome, 'xdg', 'agent-manager');
  process.env['HOME'] = isolatedHome;
  process.env['USERPROFILE'] = isolatedHome;
});
afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  removeTempDir(isolatedHome);
});

import {
  APP_CORE_MODULE_ID,
  attemptRegistration,
  attemptStagedRegistration,
  attemptUnregistration,
  registerWithAppCore,
} from './AppCoreRegistration.js';

let lines: { source: string; message: string }[];
const log = (entry: { source: string; message: string }): void => {
  lines.push(entry);
};

beforeEach(() => {
  lines = [];
  // vi.resetAllMocks() above: every test sets what it needs.
  sdk.describeRegistration.mockImplementation((outcome: { status: string }) => `described:${outcome.status}`);
});

describe('APP_CORE_MODULE_ID', () => {
  it('is "agent-manager"', () => {
    expect(APP_CORE_MODULE_ID).toBe('agent-manager');
  });
});

describe('attemptRegistration', () => {
  it.each([
    ['registered', true],
    ['deferred', true],
    ['skipped', true],
    ['refused', false],
  ])('maps the app-core outcome "%s" to ok=%s and keeps the SDK wording', async (status, ok) => {
    sdk.registerModule.mockResolvedValue({ status });
    const result = await attemptRegistration('/abs/manifest.json');
    expect(sdk.registerModule).toHaveBeenCalledWith({ id: 'agent-manager', manifestPath: '/abs/manifest.json' });
    expect(result).toEqual({ ok, status, message: `described:${status}` });
  });

  it('reports a rejection of the SDK (bad APP_CORE_PORT, missing manifest) as failed, with the reason', async () => {
    sdk.registerModule.mockRejectedValue(new Error('APP_CORE_PORT "abc" is not a port'));
    const result = await attemptRegistration('/abs/manifest.json');
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.message).toContain('APP_CORE_PORT "abc" is not a port');
  });
});

describe('attemptRegistration, outcome "unconfirmed"', () => {
  const unconfirmed = { status: 'unconfirmed', port: 4850, failure: 'timeout', timeoutMs: 3000 };

  it('is not a failure (ok) and is not "registered": the status stays, the SDK wording is kept and the retry command is added', async () => {
    sdk.registerModule.mockResolvedValue(unconfirmed);
    const result = await attemptRegistration('/abs/manifest.json');
    expect(result).toMatchObject({ ok: true, status: 'unconfirmed' });
    expect(result.message).toContain('described:unconfirmed');
    expect(result.message).toContain('agent-manager cli register');
  });

  it('does not add the retry command to the outcomes that need none', async () => {
    sdk.registerModule.mockResolvedValue({ status: 'registered' });
    expect((await attemptRegistration('/abs/manifest.json')).message).toBe('described:registered');
  });

  it('is logged with the retry command by the best-effort caller (updater)', async () => {
    sdk.registerModule.mockResolvedValue(unconfirmed);
    await registerWithAppCore('/abs/manifest.json', log);
    expect(lines[0]!.message).toContain('described:unconfirmed');
    expect(lines[0]!.message).toContain('agent-manager cli register');
  });
});

describe('attemptUnregistration', () => {
  it('outcome "unconfirmed" is ok but says to run "agent-manager cli unregister" again', async () => {
    sdk.unregisterModule.mockResolvedValue({
      status: 'unconfirmed',
      action: 'unregister',
      port: 4850,
      failure: 'reset',
    });
    const result = await attemptUnregistration();
    expect(result).toMatchObject({ ok: true, status: 'unconfirmed' });
    expect(result.message).toContain('described:unconfirmed');
    expect(result.message).toContain('agent-manager cli unregister');
  });

  it.each([
    ['unregistered', true],
    ['not-registered', true],
    ['cleared', true],
    ['skipped', true],
    ['refused', false],
  ])('maps the app-core outcome "%s" to ok=%s', async (status, ok) => {
    sdk.unregisterModule.mockResolvedValue({ status });
    const result = await attemptUnregistration();
    expect(sdk.unregisterModule).toHaveBeenCalledWith({ id: 'agent-manager' });
    expect(result).toEqual({ ok, status, message: `described:${status}` });
  });

  it('reports a rejection of the SDK as failed, with the reason', async () => {
    sdk.unregisterModule.mockRejectedValue(new Error('boom'));
    const result = await attemptUnregistration();
    expect(result).toMatchObject({ ok: false, status: 'failed' });
    expect(result.message).toContain('boom');
  });
});

describe('registerWithAppCore (best-effort)', () => {
  it('logs what app-core answered', async () => {
    sdk.registerModule.mockResolvedValue({ status: 'registered' });
    await registerWithAppCore('/abs/manifest.json', log);
    expect(lines).toEqual([{ source: 'AppCoreRegistration', message: 'described:registered' }]);
  });

  it('logs the refusal of app-core instead of hiding it', async () => {
    sdk.registerModule.mockResolvedValue({ status: 'refused' });
    await registerWithAppCore('/abs/manifest.json', log);
    expect(lines[0]!.message).toBe('described:refused');
  });

  it('never throws when the SDK rejects, and logs the failure', async () => {
    sdk.registerModule.mockRejectedValue(new Error('no such manifest'));
    await expect(registerWithAppCore('/abs/manifest.json', log)).resolves.toBeUndefined();
    expect(lines[0]!.message).toContain('no such manifest');
  });
});

describe('attemptStagedRegistration', () => {
  let root: string;
  let configDir: string;

  function installModule(version: string): string {
    const dir = path.join(root, 'npm', 'app-module');
    removeTempDir(dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version }));
    fs.writeFileSync(path.join(dir, 'backend.js'), `backend ${version}`);
    return path.join(dir, 'manifest.json');
  }

  const staged = (version: string): string => path.join(configDir, 'app-module', version, 'manifest.json');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-manager-staged-reg-'));
    configDir = path.join(root, 'config');
  });

  afterEach(() => {
    removeTempDir(root);
  });

  it('registers the STAGED manifest, not the npm one', async () => {
    sdk.registerModule.mockResolvedValue({ status: 'registered' });
    const result = await attemptStagedRegistration(installModule('1.0.0'), configDir);
    expect(sdk.registerModule).toHaveBeenCalledWith({ id: 'agent-manager', manifestPath: staged('1.0.0') });
    expect(result).toEqual({ ok: true, status: 'registered', message: 'described:registered' });
    expect(fs.existsSync(staged('1.0.0'))).toBe(true);
  });

  it.each(['registered', 'deferred'])('prunes the older staged versions once the outcome is "%s"', async status => {
    sdk.registerModule.mockResolvedValue({ status });
    await attemptStagedRegistration(installModule('1.0.0'), configDir);
    await attemptStagedRegistration(installModule('2.0.0'), configDir);
    expect(fs.existsSync(staged('2.0.0'))).toBe(true);
    expect(fs.existsSync(staged('1.0.0'))).toBe(false);
  });

  it.each(['refused', 'skipped', 'unconfirmed'])(
    'keeps the previous staged version when the outcome is "%s" (app-core may still use it)',
    async status => {
      sdk.registerModule.mockResolvedValueOnce({ status: 'registered' });
      await attemptStagedRegistration(installModule('1.0.0'), configDir);
      sdk.registerModule.mockResolvedValueOnce({ status });
      await attemptStagedRegistration(installModule('2.0.0'), configDir);
      expect(fs.existsSync(staged('1.0.0'))).toBe(true);
      expect(fs.existsSync(staged('2.0.0'))).toBe(true);
    }
  );

  it('keeps the previous staged version when the SDK rejects', async () => {
    sdk.registerModule.mockResolvedValueOnce({ status: 'registered' });
    await attemptStagedRegistration(installModule('1.0.0'), configDir);
    sdk.registerModule.mockRejectedValueOnce(new Error('boom'));
    const result = await attemptStagedRegistration(installModule('2.0.0'), configDir);
    expect(result).toMatchObject({ ok: false, status: 'failed' });
    expect(fs.existsSync(staged('1.0.0'))).toBe(true);
  });

  it('never throws when staging fails: not ok, the message names source and destination, app-core is not called', async () => {
    const source = installModule('1.0.0');
    fs.writeFileSync(configDir, 'a file where the config dir should be');
    const result = await attemptStagedRegistration(source, configDir);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.message).toContain(path.dirname(source));
    expect(result.message).toContain(path.join(configDir, 'app-module', '1.0.0'));
    expect(sdk.registerModule).not.toHaveBeenCalled();
  });

  it('registers a source checkout manifest (dist-module) as it is: a rebuild must be seen without a new version', async () => {
    sdk.registerModule.mockResolvedValue({ status: 'registered' });
    const dir = path.join(root, 'packages', 'app-module-agent-manager', 'dist-module');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '0.0.0-local' }));
    await attemptStagedRegistration(path.join(dir, 'manifest.json'), configDir);
    expect(sdk.registerModule).toHaveBeenCalledWith({ id: 'agent-manager', manifestPath: path.join(dir, 'manifest.json') });
    expect(fs.existsSync(path.join(configDir, 'app-module'))).toBe(false);
  });
});

describe('registerWithAppCore stages an installed module', () => {
  it('registers the staged manifest and logs the answer', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-manager-staged-log-'));
    const saved = process.env['AGENT_MANAGER_CONFIG_DIR'];
    process.env['AGENT_MANAGER_CONFIG_DIR'] = path.join(root, 'xdg', 'agent-manager');
    try {
      const dir = path.join(root, 'npm', 'app-module');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '3.0.0' }));
      sdk.registerModule.mockResolvedValue({ status: 'registered' });
      await registerWithAppCore(path.join(dir, 'manifest.json'), log);
      const registered = sdk.registerModule.mock.calls[0]![0] as { manifestPath: string };
      expect(registered.manifestPath).toBe(
        path.join(root, 'xdg', 'agent-manager', 'app-module', '3.0.0', 'manifest.json')
      );
      expect(lines[0]!.message).toBe('described:registered');
    } finally {
      if (saved === undefined) {
        delete process.env['AGENT_MANAGER_CONFIG_DIR'];
      } else {
        process.env['AGENT_MANAGER_CONFIG_DIR'] = saved;
      }
      removeTempDir(root);
    }
  });
});

describe('attemptUnregistration removes the staged copies (the signal of "registered")', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;
  const stagedDir = (): string => path.join(configRoot, 'agent-manager', 'app-module', '1.0.0');

  beforeEach(() => {
    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-manager-unreg-'));
    savedConfigDir = process.env['AGENT_MANAGER_CONFIG_DIR'];
    process.env['AGENT_MANAGER_CONFIG_DIR'] = path.join(configRoot, 'agent-manager');
    fs.mkdirSync(stagedDir(), { recursive: true });
    fs.writeFileSync(path.join(stagedDir(), 'manifest.json'), '{}');
  });

  afterEach(() => {
    if (savedConfigDir === undefined) {
      delete process.env['AGENT_MANAGER_CONFIG_DIR'];
    } else {
      process.env['AGENT_MANAGER_CONFIG_DIR'] = savedConfigDir;
    }
    removeTempDir(configRoot);
  });

  it.each(['unregistered', 'not-registered', 'cleared', 'skipped'])('after the outcome "%s"', async (status) => {
    sdk.unregisterModule.mockResolvedValue({ status });
    await attemptUnregistration();
    expect(fs.existsSync(path.join(configRoot, 'agent-manager', 'app-module'))).toBe(false);
  });

  it('keeps them when app-core refused (it may still use the module) or the call failed', async () => {
    sdk.unregisterModule.mockResolvedValue({ status: 'refused' });
    await attemptUnregistration();
    sdk.unregisterModule.mockRejectedValue(new Error('boom'));
    await attemptUnregistration();
    expect(fs.existsSync(stagedDir())).toBe(true);
  });
});
