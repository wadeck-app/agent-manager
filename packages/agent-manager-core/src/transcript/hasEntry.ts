import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * True when a line of the transcript has `uuid` equal to `uuid`. Streams the file line by line (a transcript can be tens of MB), parses only the lines that
 * contain the text. Rejects when the file cannot be read: the caller reports it, a missing anchor is not the same as an unreadable file.
 */
export async function transcriptHasUuid(path: string, uuid: string): Promise<boolean> {
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.includes(uuid)) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === 'object' && parsed !== null && Reflect.get(parsed, 'uuid') === uuid) {
          return true;
        }
      } catch {
        // A line that is not JSON (a half-written last line) cannot be the anchor.
      }
    }
    return false;
  } finally {
    lines.close();
  }
}
