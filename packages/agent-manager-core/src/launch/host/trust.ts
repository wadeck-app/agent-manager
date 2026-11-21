import { readFile } from 'node:fs/promises';
import { getErrorMessage } from '../../errors.js';

/*
 * Is a folder trusted by Claude Code? An interactive `claude` (the hc host) in a folder that is not trusted stops on the trust dialog (cursor on "No, exit"):
 * the terminal would never register and the launch would time out, after the old host was already stopped (measured, research/adopt-host-switch.md a9). So the
 * switch to hc checks it BEFORE stopping anything. Source of the fact: `projects["<path with forward slashes>"].hasTrustDialogAccepted` of `~/.claude.json`
 * (read only, never written). Only the folder's OWN entry counts as trusted. A trusted PARENT is reported as `inherited` and is NOT trusted: it is not measured
 * that Claude Code honours the trust of a parent folder, so the caller refuses for an hc target (unless forced) rather than stop a session for a terminal that
 * may block on the dialog.
 */

export type FolderTrust = { trusted: true } | { trusted: false; reason: string; inherited?: string };

function keyOf(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** The folder and its parents, nearest first (the folder, its parent, and so on up to the root). */
function chain(path: string): string[] {
  const keys: string[] = [];
  let current = keyOf(path);
  while (current !== '' && !keys.includes(current)) {
    keys.push(current);
    const cut = current.lastIndexOf('/');
    current = cut <= 0 ? '' : current.slice(0, cut);
  }
  return keys;
}

export async function checkFolderTrust(cwd: string, claudeJsonPath: string): Promise<FolderTrust> {
  let text: string;
  try {
    text = await readFile(claudeJsonPath, 'utf8');
  } catch (error) {
    return { trusted: false, reason: `Claude Code's config file ${claudeJsonPath} cannot be read (${getErrorMessage(error)}), so it cannot be checked that ${cwd} is trusted. Open claude once in that folder and accept the trust dialog (cd "${cwd}" and run claude), then retry` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { trusted: false, reason: `Claude Code's config file ${claudeJsonPath} is not valid JSON (${getErrorMessage(error)}), so it cannot be checked that ${cwd} is trusted. Fix or restore the file (agent-manager never edits it), then retry` };
  }
  const projects: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'projects') : undefined;
  const trusted = new Map<string, boolean>();
  if (typeof projects === 'object' && projects !== null) {
    for (const [key, value] of Object.entries(projects)) {
      trusted.set(keyOf(key).toLowerCase(), typeof value === 'object' && value !== null && Reflect.get(value, 'hasTrustDialogAccepted') === true);
    }
  }
  const [own, ...parents] = chain(cwd);
  if (own !== undefined && trusted.get(own.toLowerCase()) === true) {
    return { trusted: true };
  }
  const parent = parents.find((key) => trusted.get(key.toLowerCase()) === true);
  if (parent !== undefined) {
    return { trusted: false, inherited: parent, reason: `the folder ${cwd} has no trust of its own: only its parent ${parent} is trusted, and it is not verified that Claude Code honours the trust of a parent folder (an interactive claude there may stop on the trust dialog). Open claude once in the folder to trust it: cd "${cwd}", run claude and accept the dialog (it is then stored in ${claudeJsonPath})` };
  }
  return { trusted: false, reason: `the folder ${cwd} is not trusted by Claude Code: an interactive claude there would stop on the trust dialog and never start. Trust it once: cd "${cwd}", run claude and accept the dialog (it is then stored in ${claudeJsonPath}), then retry` };
}
