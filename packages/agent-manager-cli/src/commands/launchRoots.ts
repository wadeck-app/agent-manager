// agent-manager launch-roots show | add <path> | remove <path> -- the folders the web UI may browse to choose where a new session starts (key `launchRoots` of <config folder>/config.yml). No daemon.
import { FolderError, LAUNCH_ROOTS_KEY, addLaunchRoot, readLaunchRoots, removeLaunchRoot } from '@wadeck-app/agent-manager-core/folders';
import type { Command, CommandOutput } from '../command.js';
import { CliError, getErrorMessage } from '../errors.js';

/** A failure of the folder side already says what happened and what to do. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FolderError) {
      throw new CliError(getErrorMessage(error));
    }
    throw error;
  }
}

const NOTES = [
  'Besides these, the page may browse the parent folder of every folder your sessions ran in (never the home folder or a drive root on its own).',
  'The change is effective at once: reload the New session dialog, no restart. A path outside the roots can still be typed in the Folder field.',
];

function listLines(roots: readonly string[]): string[] {
  return roots.length === 0 ? ['No launch root configured.'] : ['Launch roots:', ...roots.map((root) => `  ${root}`)];
}

const showCommand: Command = {
  name: 'launch-roots show',
  summary: `Show the folders the web UI may browse to choose where a session starts (${LAUNCH_ROOTS_KEY} of config.yml)`,
  args: [],
  options: {},
  run: async (context): Promise<CommandOutput> => {
    const setting = await guarded(() => readLaunchRoots(context.configDir));
    const from = setting.source === 'config.yml' ? setting.file : `default (${setting.file} does not set ${LAUNCH_ROOTS_KEY})`;
    return {
      json: { roots: setting.roots, source: setting.source, file: setting.file },
      lines: [...listLines(setting.roots), `From: ${from}`, "Change it: 'agent-manager launch-roots add <path>' or 'launch-roots remove <path>'", ...NOTES],
    };
  },
};

const addCommand: Command = {
  name: 'launch-roots add',
  summary: 'Allow the web UI to browse a folder (and everything below it) when choosing where a session starts. The folder must exist',
  args: ['path'],
  options: {},
  run: async (context, args): Promise<CommandOutput> => {
    const change = await guarded(() => addLaunchRoot(context.configDir, args[0]!));
    const head = change.changed ? `Added to ${change.file}.` : 'Already a launch root: nothing was written.';
    return { json: { ok: true, changed: change.changed, roots: change.roots, file: change.file }, lines: [head, ...listLines(change.roots), ...NOTES] };
  },
};

const removeCommand: Command = {
  name: 'launch-roots remove',
  summary: 'Stop allowing the web UI to browse a folder (the folder itself is not touched, and need not exist any more)',
  args: ['path'],
  options: {},
  run: async (context, args): Promise<CommandOutput> => {
    const change = await guarded(() => removeLaunchRoot(context.configDir, args[0]!));
    if (!change.changed) {
      throw new CliError(`${args[0]!} is not a launch root of ${change.file}. Nothing was written. Fix: run 'agent-manager launch-roots show' and give the path as it is listed`);
    }
    return { json: { ok: true, changed: true, roots: change.roots, file: change.file }, lines: [`Removed from ${change.file}.`, ...listLines(change.roots), ...NOTES] };
  },
};

export const LAUNCH_ROOTS_COMMANDS: Command[] = [showCommand, addCommand, removeCommand];
