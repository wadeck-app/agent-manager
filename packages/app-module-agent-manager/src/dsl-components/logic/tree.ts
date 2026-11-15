import { ATTENTION, worstState, type AgentState, type SessionRowDto } from './states.js';
import { sortForState } from './grouping.js';

export interface FolderNode {
  /** The working directory, the identity of the folder. */
  cwd: string;
  /** Last directory of the path. */
  folder: string;
  /** The parent path to show muted, only when another folder has the same last directory (otherwise empty). */
  disambiguation: string;
  /** The worst state of its sessions: what the folder shows when collapsed. */
  rollup: AgentState;
  /** Sessions per state, for the compact roll-up dots. */
  counts: Partial<Record<AgentState, number>>;
  sessions: SessionRowDto[];
}

/** The path without its last directory ("/work/shop" gives "/work"), with either separator. */
export function parentPath(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return cut <= 0 ? '' : trimmed.slice(0, cut);
}

/** Folders by working directory, the most urgent first (then the largest, then by name); inside a folder the sessions most urgent first. */
export function buildTree(sessions: readonly SessionRowDto[]): FolderNode[] {
  const byCwd = new Map<string, SessionRowDto[]>();
  for (const session of sessions) {
    const list = byCwd.get(session.cwd);
    if (list === undefined) {
      byCwd.set(session.cwd, [session]);
    } else {
      list.push(session);
    }
  }
  const nodes: FolderNode[] = [...byCwd.entries()].map(([cwd, list]) => {
    const counts: Partial<Record<AgentState, number>> = {};
    for (const session of list) {
      counts[session.state] = (counts[session.state] ?? 0) + 1;
    }
    const ordered = [...list].sort((a, b) => ATTENTION[b.state] - ATTENTION[a.state] || sortForState(a.state)(a, b));
    return { cwd, folder: list[0]?.folder ?? cwd, disambiguation: '', rollup: worstState(list.map((session) => session.state)) ?? 'idle', counts, sessions: ordered };
  });
  const sameName = new Map<string, number>();
  for (const node of nodes) {
    sameName.set(node.folder, (sameName.get(node.folder) ?? 0) + 1);
  }
  for (const node of nodes) {
    if ((sameName.get(node.folder) ?? 0) > 1) {
      node.disambiguation = parentPath(node.cwd);
    }
  }
  return nodes.sort((a, b) => ATTENTION[b.rollup] - ATTENTION[a.rollup] || b.sessions.length - a.sessions.length || a.folder.localeCompare(b.folder) || a.cwd.localeCompare(b.cwd));
}

/** Folders that do not need you: the ones the "attention only" sub-variant starts collapsed. */
export function quietFolders(nodes: readonly FolderNode[]): string[] {
  return nodes.filter((node) => node.rollup !== 'needs-you' && node.rollup !== 'done' && node.rollup !== 'other').map((node) => node.cwd);
}
