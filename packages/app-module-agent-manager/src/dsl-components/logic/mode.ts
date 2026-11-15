import { DEFAULT_MODE, isMode, MODE_LABEL, MODES, type ModeId } from '../shared.js';

export const MODE_STORAGE_KEY = 'agent-manager.mode';

/** The mode saved by the user, or undefined when nothing valid is saved. A storage that throws (private mode) means "nothing saved". */
export function readSavedMode(): ModeId | undefined {
  try {
    const saved = window.localStorage.getItem(MODE_STORAGE_KEY);
    return isMode(saved) ? saved : undefined;
  } catch {
    return undefined;
  }
}

export function saveMode(mode: ModeId): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Not saved: the page opens on the default mode after a reload. Nothing the user could fix, nothing worth an error banner.
  }
}

export interface ResolvedMode {
  mode: ModeId;
  /** Set when the URL asked for a mode that does not exist: the page shows it (never a silent fallback). */
  note: string;
}

/**
 * The mode to show. The URL parameter wins (a shared link), then the saved choice, then the default (Tree). A URL value that is not a mode falls back to the
 * default AND says so: the saved choice is not used then, because the URL is what the user (or a link) just asked for.
 */
export function resolveMode(param: string | null, saved: ModeId | undefined): ResolvedMode {
  if (param === null || param === '') {
    return { mode: saved ?? DEFAULT_MODE, note: '' };
  }
  if (isMode(param)) {
    return { mode: param, note: '' };
  }
  return { mode: DEFAULT_MODE, note: `The address asks for the mode '${param}', which does not exist. Showing ${MODE_LABEL[DEFAULT_MODE]}. Modes: ${MODES.join(', ')}.` };
}
