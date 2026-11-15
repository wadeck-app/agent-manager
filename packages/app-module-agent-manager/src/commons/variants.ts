/** The ways to list the agents on the page, switched by the toggle at the top of the workspace (the URL parameter `mode`). The first one is the default. */
export const MODES = ['tree', 'groups', 'inbox'] as const;
export type ModeId = (typeof MODES)[number];
export const DEFAULT_MODE: ModeId = 'tree';

/** The label of each mode, for the toggle and for the notes. */
export const MODE_LABEL: Record<ModeId, string> = { tree: 'Tree', groups: 'Groups', inbox: 'Inbox' };

export function isMode(value: unknown): value is ModeId {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}
