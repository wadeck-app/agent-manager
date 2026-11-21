import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { getErrorMessage } from '../errors.js';
import { AtomicWriteError, replaceFileAtomic } from '../fsAtomic.js';
import { FolderError } from './errors.js';
import { checkAbsolutePath, pathKey } from './paths.js';

/**
 * The folders the web UI may browse to pick the folder of a new session, written in `<config folder>/config.yml` as a top-level block list:
 *
 *     launchRoots:
 *       - /home/me/work
 *       - '/data/projects'
 *
 * (A Windows path goes in single quotes, where a backslash is a backslash.)
 *
 * Only this block form is read (a flow list `[a, b]` or a value on the key line is an explicit error, never guessed); the rest of the file is kept byte for byte.
 * Folders below a root are browsable; the code that browses adds the parents of the folders sessions already run in (the module's foldersScope).
 */
export const LAUNCH_ROOTS_KEY = 'launchRoots';

const KEY_LINE = /^launchRoots[ \t]*:(.*)$/;
const INDENTED_KEY_LINE = /^[ \t]+launchRoots[ \t]*:/;
// An item may sit at the same column as its key (`launchRoots:` then `- /a`): both are valid YAML.
const ITEM_LINE = /^[ \t]*-[ \t]+(.*)$/;
const BOM = '\uFEFF';

export interface LaunchRootsSetting {
  /** The folders of config.yml, normalized, in file order. */
  roots: string[];
  /** 'config.yml' when the file has a `launchRoots` key, 'default' otherwise (an empty list: nothing configured). */
  source: 'config.yml' | 'default';
  /** The file that was read (also when it does not exist). */
  file: string;
}

function configFile(configDir: string): string {
  return join(configDir, 'config.yml');
}

/**
 * The text without its trailing comment. A hash starts a comment only after whitespace and outside quotes: a quoted folder such as 'My #1' keeps its hash. A quoted scalar is
 * cut after its closing quote; text that follows the quote without a comment is left for scalarOf to refuse.
 */
function stripComment(text: string): string {
  const value = text.trim();
  const quoted = value.startsWith("'") ? /^('(?:[^']|'')*')(.*)$/.exec(value) : value.startsWith('"') ? /^("(?:[^"\\]|\\.)*")(.*)$/.exec(value) : null;
  if (quoted !== null) {
    const rest = quoted[2]!;
    return rest.trim() === '' || /^[ \t]+#/.test(rest) ? quoted[1]! : value;
  }
  return value.replace(/(^|[ \t])#.*$/, '').trim();
}

const SINGLE_QUOTED = /^'(?:[^']|'')*'$/;
const DOUBLE_QUOTED = /^"(?:[^"\\]|\\[\\"])*"$/;
// violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
const EXAMPLE_ITEM = "- 'C:\\Projects'";

/** The scalar of a list item: plain, 'single quoted' (a doubled quote is one quote) or "double quoted" (only \\ and \" are escapes: Windows paths belong in single quotes). */
function scalarOf(text: string, where: string): string {
  const value = stripComment(text);
  if (value === '') {
    throw new FolderError('invalid-config', `${where}: a launchRoots item is empty`, `write one folder per item: ${EXAMPLE_ITEM}`);
  }
  if (value.startsWith("'")) {
    if (!SINGLE_QUOTED.test(value)) {
      throw new FolderError('invalid-config', `${where}: the quoted item ${value} is not closed or has text after the quote`, `write the folder in single quotes: ${EXAMPLE_ITEM}`);
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('"')) {
    if (!DOUBLE_QUOTED.test(value)) {
      throw new FolderError('invalid-config', `${where}: the item ${value} is not a valid double-quoted text (only \\\\ and \\" are escapes)`, `write the folder in single quotes, where a backslash is a backslash: ${EXAMPLE_ITEM}`);
    }
    return value.slice(1, -1).replace(/\\([\\"])/g, '$1');
  }
  if (/^[[{|>&*!%@`]/.test(value)) {
    throw new FolderError('invalid-config', `${where}: the item ${value} is not a plain folder path`, `write one folder per item: ${EXAMPLE_ITEM}`);
  }
  return value;
}

interface Block {
  /** Index of the `launchRoots:` line, or -1. */
  start: number;
  /** Index after the last item of the block (what a rewrite replaces: the key line, the items, and the comments or blank lines between them). */
  end: number;
  items: { line: number; text: string }[];
}

/** Finds the block, refusing every shape this reader does not understand. */
function findBlock(file: string, lines: readonly string[]): Block {
  const indented = lines.findIndex((line) => INDENTED_KEY_LINE.test(line));
  if (indented >= 0) {
    throw new FolderError('invalid-config', `${file} line ${indented + 1}: ${LAUNCH_ROOTS_KEY} is indented (nested under another key?): only a top-level ${LAUNCH_ROOTS_KEY} is read`, `write ${LAUNCH_ROOTS_KEY}: at the start of the line, outside any other key`);
  }
  const keys: number[] = [];
  lines.forEach((line, index) => {
    if (KEY_LINE.test(line.replace(/\r$/, ''))) {
      keys.push(index);
    }
  });
  if (keys.length === 0) {
    return { start: -1, end: -1, items: [] };
  }
  if (keys.length > 1) {
    throw new FolderError('invalid-config', `${file}: ${LAUNCH_ROOTS_KEY} is set ${keys.length} times (lines ${keys.map((index) => index + 1).join(', ')})`, `keep one ${LAUNCH_ROOTS_KEY} block`);
  }
  const start = keys[0]!;
  const rest = stripComment(KEY_LINE.exec(lines[start]!.replace(/\r$/, ''))![1]!);
  if (rest !== '' && rest !== '[]') {
    throw new FolderError(
      'invalid-config',
      `${file} line ${start + 1}: ${LAUNCH_ROOTS_KEY} must be a block list (one '- folder' line per root), got '${rest}'`,
      `write ${LAUNCH_ROOTS_KEY}: then one indented line per folder, e.g. "  ${EXAMPLE_ITEM}", or run 'agent-manager launch-roots add <path>'`,
    );
  }
  const items: Block['items'] = [];
  let end = start + 1;
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!.replace(/\r$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }
    const item = ITEM_LINE.exec(line);
    if (item === null) {
      // Anything indented, or a dash, right after the items is part of the list as far as YAML goes: refusing it keeps a rewrite from leaving it orphaned.
      if (/^[ \t]/.test(line) || line.startsWith('-')) {
        throw new FolderError('invalid-config', `${file} line ${index + 1}: this line belongs to ${LAUNCH_ROOTS_KEY} but is not a '- folder' item`, `write one '- folder' line per root under ${LAUNCH_ROOTS_KEY}, or remove the line`);
      }
      break;
    }
    items.push({ line: index, text: item[1]! });
    end = index + 1;
  }
  if (rest === '[]' && items.length > 0) {
    throw new FolderError('invalid-config', `${file} line ${start + 1}: ${LAUNCH_ROOTS_KEY} is [] but items follow`, 'remove the [] or the items');
  }
  return { start, end, items };
}

function split(text: string): { bom: boolean; lines: string[]; cr: string } {
  const bom = text.startsWith(BOM);
  const body = bom ? text.slice(BOM.length) : text;
  return { bom, lines: body.split('\n'), cr: text.includes('\r\n') ? '\r' : '' };
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw new FolderError('config-unreadable', `cannot read ${file} (${getErrorMessage(error)})`, 'check the permissions of the file');
  }
}

function rootsOf(file: string, lines: readonly string[]): { roots: string[]; found: boolean } {
  const block = findBlock(file, lines);
  const roots = block.items.map((item) => {
    const where = `${file} line ${item.line + 1}`;
    try {
      return checkAbsolutePath(scalarOf(item.text, where), 'the root');
    } catch (error) {
      if (error instanceof FolderError && error.code !== 'invalid-config') {
        throw new FolderError('invalid-config', `${where}: ${error.reason}`, `fix or remove this item ('agent-manager launch-roots show' lists what is read): ${error.fix}`);
      }
      throw error;
    }
  });
  return { roots, found: block.start >= 0 };
}

/** Reads `launchRoots` from `<configDir>/config.yml`. A missing file or key is an empty list (said in `source`); anything unreadable or malformed throws, never an empty list. */
export async function readLaunchRoots(configDir: string): Promise<LaunchRootsSetting> {
  const file = configFile(configDir);
  const { roots, found } = rootsOf(file, split(await readText(file)).lines);
  return { roots, source: found ? 'config.yml' : 'default', file };
}

function quoted(path: string): string {
  return `'${path.replace(/'/g, "''")}'`;
}

/** Rewrites the block with `after` (a missing block is appended); every other line is kept as it is. */
async function writeRoots(configDir: string, text: string, after: string[]): Promise<void> {
  const file = configFile(configDir);
  const { bom, lines, cr } = split(text);
  const block = findBlock(file, lines);
  const fresh = after.length === 0 ? [`${LAUNCH_ROOTS_KEY}: []${cr}`] : [`${LAUNCH_ROOTS_KEY}:${cr}`, ...after.map((root) => `  - ${quoted(root)}${cr}`)];
  if (block.start >= 0) {
    lines.splice(block.start, block.end - block.start, ...fresh);
  } else if (text === '' || (lines.length === 1 && lines[0] === '')) {
    lines.splice(0, lines.length, ...fresh, '');
  } else {
    if (lines[lines.length - 1] === '') {
      lines.pop();
    } else {
      lines[lines.length - 1] += cr;
    }
    lines.push(...fresh, '');
  }
  await fs.mkdir(configDir, { recursive: true });
  try {
    await replaceFileAtomic(file, (bom ? BOM : '') + lines.join('\n'), fs);
  } catch (error) {
    if (error instanceof AtomicWriteError) {
      throw new FolderError('config-not-written', getErrorMessage(error), 'close what holds config.yml open (an editor, a sync tool), check the permissions of the folder, then run the command again');
    }
    throw error;
  }
}

export interface LaunchRootsChange {
  roots: string[];
  /** False when the folder was already there (add) or was not there (remove): nothing was written. */
  changed: boolean;
  file: string;
}

/**
 * Adds a folder to `launchRoots`. The folder must exist and be a folder (a typo is an error, not a root that never matches); one that is already there
 * (same path, case ignored on Windows) is not an error and writes nothing.
 */
export async function addLaunchRoot(configDir: string, path: string): Promise<LaunchRootsChange> {
  const root = checkAbsolutePath(path, 'the folder');
  let stats;
  try {
    stats = await fs.stat(root);
  } catch (error) {
    throw new FolderError('root-missing', `${root} cannot be read (${getErrorMessage(error)})`, 'give the path of an existing folder');
  }
  if (!stats.isDirectory()) {
    throw new FolderError('root-not-a-folder', `${root} is a file, not a folder`, 'give the path of a folder');
  }
  const file = configFile(configDir);
  const text = await readText(file);
  const current = rootsOf(file, split(text).lines).roots;
  if (current.some((existing) => pathKey(existing) === pathKey(root))) {
    return { roots: current, changed: false, file };
  }
  const roots = [...current, root];
  await writeRoots(configDir, text, roots);
  return { roots, changed: true, file };
}

/** Removes a folder from `launchRoots` (it need not exist any more: that is how a deleted root is cleaned up). Not there: nothing is written. */
export async function removeLaunchRoot(configDir: string, path: string): Promise<LaunchRootsChange> {
  const root = checkAbsolutePath(path, 'the folder');
  const file = configFile(configDir);
  const text = await readText(file);
  const current = rootsOf(file, split(text).lines).roots;
  if (!current.some((existing) => pathKey(existing) === pathKey(root))) {
    return { roots: current, changed: false, file };
  }
  const roots = current.filter((existing) => pathKey(existing) !== pathKey(root));
  await writeRoots(configDir, text, roots);
  return { roots, changed: true, file };
}
