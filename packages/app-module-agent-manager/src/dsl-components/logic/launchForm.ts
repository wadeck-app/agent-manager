import type { OwnedHostKind, OwnedLaunchRequest } from '../shared.js';

/** The remembered choices of the New session dialog (host, model, permission mode). The folder and the name are never remembered. */
export const LAUNCH_STORAGE_KEY = 'agent-manager.launch.v1';

export interface HostChoice {
  id: OwnedHostKind;
  /** The label of the choice: the same word as the badge of the rows. */
  label: string;
  /** The code of the experiment (the plan calls them X1 and X3). */
  tag: string;
  /** One honest line about what the user gets and gives up. */
  description: string;
}

export const HOST_CHOICES: readonly HostChoice[] = [
  {
    id: 'stream-json',
    label: 'Web session',
    tag: 'X1',
    description: 'Runs as a child of the agent-manager daemon: structured log, permission requests answered in this page, no terminal to look at.',
  },
  {
    id: 'hc',
    label: 'Terminal session',
    tag: 'X3',
    description: 'Runs in a herdr-core terminal (hc): the real Claude Code screen, permission requests are answered in that terminal, not here.',
  },
];

export interface ChoiceOption {
  /** '' means "do not pass the option": Claude Code uses its own default. */
  value: string;
  label: string;
}

/** The model aliases Claude Code accepts (`--model haiku`); the daemon only checks the shape, so a model Claude Code does not know fails at launch with its own message. */
export const MODEL_OPTIONS: readonly ChoiceOption[] = [
  { value: '', label: 'Default (Claude Code decides)' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
];

/** The permission modes of `claude --permission-mode`; the daemon only checks that it is one word, so Claude Code is the judge of the names. */
export const PERMISSION_MODE_OPTIONS: readonly ChoiceOption[] = [
  { value: '', label: 'Default (Claude Code decides)' },
  { value: 'default', label: 'default: ask before each tool' },
  { value: 'acceptEdits', label: 'acceptEdits: file edits without asking' },
  { value: 'plan', label: 'plan: read-only, a plan first' },
  { value: 'auto', label: 'auto: a classifier decides' },
];

export interface LaunchPrefs {
  hostKind: OwnedHostKind;
  model: string;
  permissionMode: string;
}

export const DEFAULT_LAUNCH_PREFS: LaunchPrefs = { hostKind: 'stream-json', model: '', permissionMode: '' };

function knows(options: readonly ChoiceOption[], value: unknown): value is string {
  return typeof value === 'string' && options.some((option) => option.value === value);
}

/** What was saved, field by field: a missing, unknown or corrupt field gets the default (a stale choice must not break the dialog). A storage that throws means nothing saved. */
export function readLaunchPrefs(): LaunchPrefs {
  try {
    const raw = window.localStorage.getItem(LAUNCH_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_LAUNCH_PREFS;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEFAULT_LAUNCH_PREFS;
    }
    const saved: Record<string, unknown> = Object.fromEntries(Object.entries(parsed));
    const host = HOST_CHOICES.find((choice) => choice.id === saved['hostKind']);
    return {
      hostKind: host === undefined ? DEFAULT_LAUNCH_PREFS.hostKind : host.id,
      model: knows(MODEL_OPTIONS, saved['model']) ? saved['model'] : DEFAULT_LAUNCH_PREFS.model,
      permissionMode: knows(PERMISSION_MODE_OPTIONS, saved['permissionMode']) ? saved['permissionMode'] : DEFAULT_LAUNCH_PREFS.permissionMode,
    };
  } catch {
    return DEFAULT_LAUNCH_PREFS;
  }
}

/** Returns an error text when the choices could not be kept (a browser that refuses storage), so the dialog can say it instead of forgetting silently. */
export function saveLaunchPrefs(prefs: LaunchPrefs): string {
  try {
    window.localStorage.setItem(LAUNCH_STORAGE_KEY, JSON.stringify(prefs));
    return '';
  } catch (error) {
    return `Your choices could not be remembered for next time (${String(error)}).`;
  }
}

export const MAX_CWD_CHARS = 1024;
export const MAX_NAME_CHARS = 64;
const HC_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** A Windows drive path (C:\x or C:/x), a UNC path (\\server\share) or a POSIX path (/x). The daemon makes the real check (the folder must exist). */
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/;

/** '' when the folder text is acceptable, else what to fix. Empty is not an error text here: the Launch button is disabled while it is empty. */
export function cwdProblem(text: string): string {
  const cwd = text.trim();
  if (cwd === '') {
    return '';
  }
  if (cwd.length > MAX_CWD_CHARS) {
    return `The path has ${cwd.length} characters, the limit is ${MAX_CWD_CHARS}.`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(cwd)) {
    return 'The path must be a single line without control characters.';
  }
  if (!ABSOLUTE.test(cwd)) {
    return 'Give the absolute path of the folder (C:\\Projects\\shop or /home/me/shop): a relative path would be read against the daemon, not against you.';
  }
  return '';
}

/** '' when the name is acceptable (an empty one is fine). A terminal name is also the name of the hc terminal, which has a stricter shape. */
export function nameProblem(text: string, hostKind: OwnedHostKind): string {
  const name = text.trim();
  if (name === '') {
    return '';
  }
  if (name.length > MAX_NAME_CHARS) {
    return `The name has ${name.length} characters, the limit is ${MAX_NAME_CHARS}.`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return 'The name must be a single line without control characters.';
  }
  if (hostKind === 'hc' && !HC_NAME.test(name)) {
    return 'A terminal session name is also the name of its terminal: 1 to 32 characters of a-z, 0-9, "-" and "_", starting with a letter or a digit.';
  }
  return '';
}

export interface LaunchForm {
  hostKind: OwnedHostKind;
  cwd: string;
  model: string;
  permissionMode: string;
  name: string;
}

/** The body of POST /owned/launch: only the fields that have a value (the daemon refuses an empty string). */
export function launchBody(form: LaunchForm): OwnedLaunchRequest {
  const model = form.model.trim();
  const permissionMode = form.permissionMode.trim();
  const name = form.name.trim();
  return { hostKind: form.hostKind, cwd: form.cwd.trim(), ...(model === '' ? {} : { model }), ...(permissionMode === '' ? {} : { permissionMode }), ...(name === '' ? {} : { name }) };
}
