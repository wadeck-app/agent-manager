import { open } from 'node:fs/promises';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import { transcriptPath } from '@wadeck-app/agent-manager-core/transcript';

/** Bytes of the end of the transcript examined: the newest cwd is in the last lines, and one line can be long (tool results). */
const DEFAULT_TAIL_BYTES = 512 * 1024;

export type TranscriptCwd = { ok: true; cwd: string } | { ok: false; problem: string };

/**
 * The folder Claude Code reports for the session NOW: the `cwd` field of the newest transcript line that has one. It differs from the registry file
 * (written when the session starts) once the session ran `cd`, and the w-guardrails hook matches its bypass file with the cwd of the event, as it is.
 * Never throws: a transcript that cannot be read is a `problem` sentence the caller shows next to the folder it falls back to.
 */
export async function latestTranscriptCwd(session: { sessionId: string; cwd: string }, options: { tailBytes?: number } = {}): Promise<TranscriptCwd> {
  const found = await transcriptPath(session.cwd, session.sessionId);
  if (!found.ok) {
    const { message, fix } = found.error;
    return { ok: false, problem: `${message} ${fix}` };
  }
  const tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES;
  try {
    const handle = await open(found.path, 'r');
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - tailBytes);
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
      const rows = buffer.toString('utf8').split('\n');
      // The first row of a cut read is a part of a line.
      if (start > 0) {
        rows.shift();
      }
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i] as string;
        if (!row.includes('"cwd"')) {
          continue;
        }
        try {
          const cwd: unknown = (JSON.parse(row) as { cwd?: unknown }).cwd;
          if (typeof cwd === 'string' && cwd !== '') {
            return { ok: true, cwd };
          }
        } catch {
          // a half-written last line: the line before it is read
        }
      }
      return { ok: false, problem: `The last ${Math.round(tailBytes / 1024)} KiB of the transcript ${found.path} hold no line with a cwd.` };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return { ok: false, problem: `The transcript ${found.path} could not be read: ${getErrorMessage(error)}` };
  }
}
