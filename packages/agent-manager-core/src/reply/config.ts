import { join } from 'node:path';
import * as realFs from 'node:fs/promises';
import { DurationError, parseDuration } from '../duration.js';
import { getErrorMessage } from '../errors.js';
import { AtomicWriteError, replaceFileAtomic } from '../fsAtomic.js';
import { ReplyError, assertSafeId } from './errors.js';
import { errorCode } from './fsTypes.js';
import type { ReplyFs } from './fsTypes.js';

/** Delivery settings, in milliseconds. In `<configDir>/config.yml` they are written as durations (`30s`, `15m`, `5h`, `1d`, `1h5m30s`). */
export interface ReplyConfig {
  /** 0 = no timeout (decision 26). */
  confirmationWindowMs: number;
  /** After this, a reply on an idle session with no transcript growth shows the "probably not delivered" hint (decision 33). */
  hintAfterMs: number;
  /** Mailbox (hook) transports only (decision 27). */
  mailboxExpiryMs: number;
}

export const DEFAULT_REPLY_CONFIG: ReplyConfig = { confirmationWindowMs: 0, hintAfterMs: 15_000, mailboxExpiryMs: 15 * 60_000 };

/** The JSON-able shape of the config file (YAML scalars read as a number 0 are accepted too). */
export interface RawReplyConfig {
  confirmationWindow?: string | number;
  hintAfter?: string | number;
  mailboxExpiry?: string | number;
}

function duration(key: string, value: string | number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string') {
    throw new ReplyError('invalid-config', `${key}: expected a duration such as 15s, got ${JSON.stringify(value)}`, `write ${key} as a duration, e.g. 15s, 15m, 1h`);
  }
  try {
    return parseDuration(text);
  } catch (error) {
    if (error instanceof DurationError) {
      throw new ReplyError('invalid-config', `${key}: ${getErrorMessage(error)}`, `fix ${key} in config.yml`);
    }
    throw error;
  }
}

/** Parses the delivery settings with `parseDuration`; an invalid value throws with the parser's message and the key name. Missing keys take the defaults. */
export function parseReplyConfig(raw: RawReplyConfig = {}): ReplyConfig {
  return {
    confirmationWindowMs: duration('confirmationWindow', raw.confirmationWindow, DEFAULT_REPLY_CONFIG.confirmationWindowMs),
    hintAfterMs: duration('hintAfter', raw.hintAfter, DEFAULT_REPLY_CONFIG.hintAfterMs),
    mailboxExpiryMs: duration('mailboxExpiry', raw.mailboxExpiry, DEFAULT_REPLY_CONFIG.mailboxExpiryMs),
  };
}

/** `<configDir>/transports.json`: the global default transport and the per-session overrides (decision 19). */
export interface TransportsConfig {
  default: string;
  perSession: Record<string, string>;
}

export const DEFAULT_TRANSPORT_ID = 'socket';

export async function readTransportsConfig(configDir: string, fs: ReplyFs = realFs): Promise<TransportsConfig> {
  const file = join(configDir, 'transports.json');
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { default: DEFAULT_TRANSPORT_ID, perSession: {} };
    }
    throw new ReplyError('transports-unreadable', `cannot read ${file} (${getErrorMessage(error)})`, 'check the permissions of the file, or delete it to get the default transport');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ReplyError('transports-invalid', `${file} is not valid JSON (${getErrorMessage(error)})`, 'fix the file, or delete it to get the default transport');
  }
  const object = value as { default?: unknown; perSession?: unknown } | null;
  const perSession = object?.perSession ?? {};
  const isMap = typeof perSession === 'object' && perSession !== null && !Array.isArray(perSession) && Object.values(perSession).every((id) => typeof id === 'string');
  if (object === null || typeof object !== 'object' || (object.default !== undefined && typeof object.default !== 'string') || !isMap) {
    throw new ReplyError('transports-invalid', `${file} must look like {"default": "<transport id>", "perSession": {"<session id>": "<transport id>"}}`, 'fix the file, or delete it to get the default transport');
  }
  return { default: (object.default as string | undefined) ?? DEFAULT_TRANSPORT_ID, perSession: perSession as Record<string, string> };
}

// Updates of one file are chained in this process (the last write wins, in call order); the temp name is unique per call, also across processes.
// Two PROCESSES (the CLI and the module) changing the file at the same moment can lose one change: the file is replaced whole, never half written.
const writeChains = new Map<string, Promise<void>>();

async function chained(file: string, work: () => Promise<void>): Promise<void> {
  const previous = writeChains.get(file) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  writeChains.set(file, run);
  try {
    await run;
  } finally {
    if (writeChains.get(file) === run) {
      writeChains.delete(file);
    }
  }
}

/** Replaces transports.json whole, with the Windows retry of replaceFileAtomic; a failure is a ReplyError that says what to do. */
async function writeAtomic(configDir: string, config: TransportsConfig, fs: ReplyFs): Promise<void> {
  const file = join(configDir, 'transports.json');
  await fs.mkdir(configDir, { recursive: true });
  try {
    await replaceFileAtomic(file, `${JSON.stringify(config, null, 2)}\n`, fs);
  } catch (error) {
    if (error instanceof AtomicWriteError) {
      throw new ReplyError('transports-not-written', getErrorMessage(error), 'close what holds transports.json open (an editor, a sync tool), check the permissions of the folder, then retry');
    }
    throw error;
  }
}

/** Writes `<configDir>/transports.json` atomically (unique temp file then rename). Concurrent calls in one process run one after the other. */
export function writeTransportsConfig(configDir: string, config: TransportsConfig, fs: ReplyFs = realFs): Promise<void> {
  return chained(join(configDir, 'transports.json'), () => writeAtomic(configDir, config, fs));
}

function assertKnownTransport(id: unknown, knownIds: readonly string[]): asserts id is string {
  if (typeof id !== 'string' || !knownIds.includes(id)) {
    throw new ReplyError('unknown-transport', `there is no reply transport ${JSON.stringify(id)} (known: ${knownIds.join(', ')})`, `choose one of: ${knownIds.join(', ')}`);
  }
}

/** Reads, changes and writes transports.json in one chained step; nothing is written when `change` throws. */
async function updateTransportsConfig(configDir: string, fs: ReplyFs, change: (config: TransportsConfig) => void): Promise<TransportsConfig> {
  let result: TransportsConfig | undefined;
  await chained(join(configDir, 'transports.json'), async () => {
    const config = await readTransportsConfig(configDir, fs);
    change(config);
    await writeAtomic(configDir, config, fs);
    result = config;
  });
  if (result === undefined) {
    throw new ReplyError('transports-not-written', 'transports.json was not written', 'retry');
  }
  return result;
}

/** Sets the global default transport. `transportId` must be one of `knownIds` (the transports registered by the caller), else an explicit error. Returns the new config. */
export async function setDefaultTransport(configDir: string, transportId: string, knownIds: readonly string[], fs: ReplyFs = realFs): Promise<TransportsConfig> {
  assertKnownTransport(transportId, knownIds);
  return updateTransportsConfig(configDir, fs, (config) => {
    config.default = transportId;
  });
}

/** Sets the transport of one session, or clears its override with `null` (the session then follows the default). Returns the new config. */
export async function setSessionTransport(configDir: string, sessionId: string, transportId: string | null, knownIds: readonly string[], fs: ReplyFs = realFs): Promise<TransportsConfig> {
  assertSafeId('session id', sessionId);
  if (transportId !== null) {
    assertKnownTransport(transportId, knownIds);
  }
  return updateTransportsConfig(configDir, fs, (config) => {
    if (transportId === null) {
      delete config.perSession[sessionId];
    } else {
      config.perSession[sessionId] = transportId;
    }
  });
}
