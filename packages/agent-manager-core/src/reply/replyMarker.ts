import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import * as realFs from 'node:fs/promises';
import { getErrorMessage } from '../errors.js';
import { ReplyError } from './errors.js';
import { errorCode } from './fsTypes.js';
import type { ReplyFs } from './fsTypes.js';

/**
 * What the origin marker line of a web reply looks like (D-2026-11-19-a, replaces spec decision 11):
 * none: no marker, the text exactly as typed; short: `[agent-manager-web #<id>]`; full: `[web reply via agent-manager #<id>]`.
 */
export const REPLY_MARKER_MODES = ['none', 'short', 'full'] as const;
export type ReplyMarkerMode = (typeof REPLY_MARKER_MODES)[number];

/** The mode used when config.yml does not set `replyMarker` (D-2026-11-19-a). */
export const DEFAULT_REPLY_MARKER: ReplyMarkerMode = 'none';

const KEY = 'replyMarker';
const KEY_LINE = /^replyMarker[ \t]*:(.*)$/;

export interface ReplyMarkerSetting {
  mode: ReplyMarkerMode;
  /** 'config.yml' when the file sets `replyMarker`, 'default' otherwise. */
  source: 'config.yml' | 'default';
  /** The file that was read (also when it does not exist). */
  file: string;
}

/** Throws an `invalid-config` ReplyError naming the accepted values and where the value came from. */
export function parseReplyMarker(value: unknown, where: string): ReplyMarkerMode {
  if (typeof value === 'string' && (REPLY_MARKER_MODES as readonly string[]).includes(value)) {
    return value as ReplyMarkerMode;
  }
  throw new ReplyError('invalid-config', `${where}: replyMarker must be one of ${REPLY_MARKER_MODES.join(', ')}, got ${JSON.stringify(value)}`, `set replyMarker to ${REPLY_MARKER_MODES.join(', ')} (default ${DEFAULT_REPLY_MARKER}), e.g. 'agent-manager reply-marker set none'`);
}

/** The scalar of a `replyMarker: value` line: an inline comment and one pair of quotes are removed. */
function scalarOf(rest: string): string {
  const withoutComment = rest.replace(/(^|[ \t])#.*$/, '');
  const trimmed = withoutComment.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted === null ? trimmed : quoted[2]!;
}

function configFile(configDir: string): string {
  return join(configDir, 'config.yml');
}

/** The indexes of the top-level `replyMarker:` lines of the text. */
function keyLines(lines: readonly string[]): number[] {
  const found: number[] = [];
  lines.forEach((line, index) => {
    if (KEY_LINE.test(line.replace(/\r$/, ''))) {
      found.push(index);
    }
  });
  return found;
}

const BOM = '\uFEFF';
const INDENTED_KEY_LINE = /^[ \t]+replyMarker[ \t]*:/;

/** The lines of a config.yml text (BOM removed: it is put back on write) and the first-line BOM flag. */
function splitConfig(text: string): { bom: boolean; lines: string[] } {
  const bom = text.startsWith(BOM);
  return { bom, lines: (bom ? text.slice(BOM.length) : text).split('\n') };
}

/** An indented replyMarker (nested under another key, or by accident) is never read as the setting and never ignored: an explicit error. */
function assertNoIndentedKey(file: string, lines: readonly string[]): void {
  const index = lines.findIndex((line) => INDENTED_KEY_LINE.test(line));
  if (index >= 0) {
    throw new ReplyError('invalid-config', `${file} line ${index + 1}: ${KEY} is indented (nested under another key?): only a top-level ${KEY} line is read`, `write ${KEY}: ${REPLY_MARKER_MODES.join('|')} at the start of the line, outside any other key`);
  }
}

/**
 * Reads `replyMarker` from `<configDir>/config.yml` (a top-level `replyMarker: none|short|full` line; the rest of the file is not interpreted here; a UTF-8 BOM is ignored).
 * A missing file or key gives the default, said in `source`. An unreadable file, an unknown value, an empty value, a repeated key or an indented key throws (never defaulted).
 */
export async function readReplyMarker(configDir: string, fs: ReplyFs = realFs): Promise<ReplyMarkerSetting> {
  const file = configFile(configDir);
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { mode: DEFAULT_REPLY_MARKER, source: 'default', file };
    }
    throw new ReplyError('config-unreadable', `cannot read ${file} (${getErrorMessage(error)})`, 'check the permissions of the file');
  }
  const { lines } = splitConfig(text);
  assertNoIndentedKey(file, lines);
  const found = keyLines(lines);
  if (found.length === 0) {
    return { mode: DEFAULT_REPLY_MARKER, source: 'default', file };
  }
  if (found.length > 1) {
    throw new ReplyError('invalid-config', `${file}: replyMarker is set ${found.length} times (lines ${found.map((index) => index + 1).join(', ')})`, `keep one replyMarker line (${REPLY_MARKER_MODES.join(' | ')})`);
  }
  const line = lines[found[0]!]!.replace(/\r$/, '');
  const rest = KEY_LINE.exec(line)![1]!;
  return { mode: parseReplyMarker(scalarOf(rest), `${file} line ${found[0]! + 1}`), source: 'config.yml', file };
}

const RENAME_RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 5;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Replaces `file` by `next` (temp file in the same folder, then rename). On Windows a rename onto a file another process has open fails with EPERM/EACCES/EBUSY
 * for a moment (an editor, an antivirus, the updater reading config.yml): retried a few times briefly, then a clear error. NO LOCK: two processes changing config.yml at the
 * same instant can lose one change (out of scope: the file is replaced whole, never half written).
 */
async function replaceFile(file: string, next: string, fs: ReplyFs): Promise<void> {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, next, 'utf8');
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rename(temp, file);
        return;
      } catch (error) {
        if (!RENAME_RETRYABLE.has(errorCode(error) ?? '') || attempt >= RENAME_ATTEMPTS) {
          throw error;
        }
        await pause(25 * attempt);
      }
    }
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw new ReplyError('config-not-written', `cannot write ${file} (${getErrorMessage(error)})`, 'close what holds config.yml open (an editor, a sync tool), check the permissions of the folder, then run the command again');
  }
}

/**
 * Sets `replyMarker` in `<configDir>/config.yml`: replaces the line, or appends it (the file is created when missing). Every other line is kept byte for byte (BOM and line endings
 * included; when the last line had no line ending, it gets the file's one). The mode is validated first; an existing invalid, repeated or indented `replyMarker` is an error
 * (fix the file by hand), never overwritten silently.
 */
export async function setReplyMarker(configDir: string, mode: string, fs: ReplyFs = realFs): Promise<ReplyMarkerSetting> {
  const valid = parseReplyMarker(mode, 'replyMarker');
  const file = configFile(configDir);
  let text = '';
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      throw new ReplyError('config-unreadable', `cannot read ${file} (${getErrorMessage(error)})`, 'check the permissions of the file');
    }
  }
  const { bom, lines } = splitConfig(text);
  const crlf = text.includes('\r\n');
  const cr = crlf ? '\r' : '';
  assertNoIndentedKey(file, lines);
  const found = keyLines(lines);
  if (found.length > 1) {
    throw new ReplyError('invalid-config', `${file}: ${KEY} is set ${found.length} times (lines ${found.map((index) => index + 1).join(', ')})`, `keep one ${KEY} line, then run the command again`);
  }
  const newLine = `${KEY}: ${valid}`;
  if (found.length === 1) {
    lines[found[0]!] = lines[found[0]!]!.endsWith('\r') ? `${newLine}\r` : newLine;
  } else if (text === '' || (lines.length === 1 && lines[0] === '')) {
    lines.splice(0, lines.length, `${newLine}${cr}`, '');
  } else {
    if (lines[lines.length - 1] === '') {
      // The file ends with a line ending: the new line goes before the empty last element.
      lines.pop();
    } else {
      // No line ending after the last line: it gets the file's one, so that endings do not get mixed.
      lines[lines.length - 1] += cr;
    }
    lines.push(`${newLine}${cr}`, '');
  }
  await fs.mkdir(configDir, { recursive: true });
  await replaceFile(file, (bom ? BOM : '') + lines.join('\n'), fs);
  return { mode: valid, source: 'config.yml', file };
}
