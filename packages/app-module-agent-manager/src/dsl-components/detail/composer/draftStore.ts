import type { AttachedImage } from './types.js';

/** What the user was writing to one session. Text survives a reload (sessionStorage); images stay in memory (too big for storage). */
export interface Draft {
  text: string;
  images: AttachedImage[];
}

const KEY = (sessionId: string): string => `agent-manager.draft.${sessionId.toLowerCase()}`;
const memory = new Map<string, Draft>();
let warned = false;

function warnOnce(error: unknown): void {
  if (!warned) {
    warned = true;
    console.warn(`[agent-manager] the draft could not be kept in sessionStorage, it only survives while this page stays open: ${String(error)}`);
  }
}

export function getDraft(sessionId: string): Draft {
  const id = sessionId.toLowerCase();
  const kept = memory.get(id);
  if (kept !== undefined) {
    return kept;
  }
  let text = '';
  try {
    text = sessionStorage.getItem(KEY(id)) ?? '';
  } catch (error) {
    warnOnce(error);
  }
  return { text, images: [] };
}

export function setDraft(sessionId: string, draft: Draft): void {
  const id = sessionId.toLowerCase();
  if (draft.text === '' && draft.images.length === 0) {
    memory.delete(id);
  } else {
    memory.set(id, draft);
  }
  try {
    if (draft.text === '') {
      sessionStorage.removeItem(KEY(id));
    } else {
      sessionStorage.setItem(KEY(id), draft.text);
    }
  } catch (error) {
    warnOnce(error);
  }
}

/** Test helper: forget the in-memory drafts. */
export function resetDrafts(): void {
  memory.clear();
}
