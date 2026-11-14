import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import * as realFs from 'node:fs/promises';
import { DurationError, parseDuration } from '../duration.js';
import { getErrorMessage } from '../errors.js';
import { ReplyError } from './errors.js';
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

// Writes to one file are chained in this process (the last write wins, in call order); the temp name is unique per call, also across processes.
const writeChains = new Map<string, Promise<void>>();

/** Writes `<configDir>/transports.json` atomically (unique temp file then rename). Concurrent calls in one process run one after the other. */
export async function writeTransportsConfig(configDir: string, config: TransportsConfig, fs: ReplyFs = realFs): Promise<void> {
  const file = join(configDir, 'transports.json');
  const previous = writeChains.get(file) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    await fs.mkdir(configDir, { recursive: true });
    const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      await fs.rename(temp, file);
    } catch (error) {
      await fs.unlink(temp).catch(() => undefined);
      throw error;
    }
  });
  writeChains.set(file, run);
  try {
    await run;
  } finally {
    if (writeChains.get(file) === run) {
      writeChains.delete(file);
    }
  }
}
