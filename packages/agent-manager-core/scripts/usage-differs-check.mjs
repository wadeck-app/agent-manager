// Read-only check: do the usage objects of assistant lines that share one message.id differ?
// Prints counts only (no text, no ids). Usage: node usage-differs-check.mjs [projectsDir] [maxFiles]
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const root = process.argv[2] ?? join(homedir(), '.claude', 'projects');
const maxFiles = Number(process.argv[3] ?? 300);

async function listJsonl(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await listJsonl(path, out);
    } else if (entry.name.endsWith('.jsonl')) {
      out.push(path);
    }
  }
}

const files = [];
await listJsonl(root, files);
const withTime = [];
for (const file of files) {
  withTime.push({ file, mtime: (await stat(file)).mtimeMs });
}
withTime.sort((a, b) => b.mtime - a.mtime);
const picked = withTime.slice(0, maxFiles);

const stats = { files: picked.length, messagesWithUsage: 0, messagesWithSeveralLines: 0, messagesWhoseUsageDiffers: 0, differingFields: {}, outputGrew: 0, outputShrank: 0 };
for (const { file } of picked) {
  const byId = new Map();
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const text of lines) {
    if (!text.includes('"usage"') || !text.includes('"assistant"')) {
      continue;
    }
    let line;
    try {
      line = JSON.parse(text);
    } catch {
      continue;
    }
    const message = line?.message;
    if (line?.type !== 'assistant' || typeof message?.id !== 'string' || typeof message?.usage !== 'object' || message.usage === null) {
      continue;
    }
    const list = byId.get(message.id) ?? [];
    list.push(message.usage);
    byId.set(message.id, list);
  }
  for (const list of byId.values()) {
    stats.messagesWithUsage++;
    if (list.length < 2) {
      continue;
    }
    stats.messagesWithSeveralLines++;
    const keys = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
    let differs = false;
    for (const key of keys) {
      const values = list.map((usage) => usage[key]);
      if (new Set(values).size > 1) {
        differs = true;
        stats.differingFields[key] = (stats.differingFields[key] ?? 0) + 1;
      }
    }
    if (differs) {
      stats.messagesWhoseUsageDiffers++;
    }
    const first = list[0].output_tokens;
    const last = list[list.length - 1].output_tokens;
    if (last > first) {
      stats.outputGrew++;
    } else if (last < first) {
      stats.outputShrank++;
    }
  }
}
console.log(JSON.stringify(stats, null, 2));
