import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { classifyHarnessText } from './harness.js';
import { ActivityAccumulator } from './activity.js';
import { TranscriptTailer } from './tailer.js';
import type { UserPromptEntry } from './types.js';
import { humanPrompt, injectedPrompt, jsonl, makeTempDir, removeDir, taskNotificationPrompt, writeText } from './testFixtures.js';

// Shapes copied (trimmed) from real transcripts: the first tag census of the newest 150 transcripts found
// command-name/command-message/command-args, local-command-stdout, local-command-caveat, system-reminder, task-notification, bash-input/stdout/stderr.
const COMPACT = '<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>';
const ESC = String.fromCharCode(27);
const COMPACT_OUT = `<local-command-stdout>${ESC}[2mCompacted (ctrl+o to see full summary)${ESC}[22m</local-command-stdout>`;
const CAVEAT = '<local-command-caveat>The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user.</local-command-caveat>';

describe('classifyHarnessText', () => {
  it('a slash command: label with its name, the summary, the arguments as detail', () => {
    expect(classifyHarnessText(COMPACT)).toMatchObject({ label: 'Command /compact', summary: '/compact', detail: '', tags: ['command-name', 'command-message', 'command-args'] });
    expect(classifyHarnessText('<command-message>w-guardrails:request-bypass</command-message>\n<command-name>/w-guardrails:request-bypass</command-name>')).toMatchObject({ label: 'Command /w-guardrails:request-bypass' });
    expect(classifyHarnessText('<command-name>/model</command-name><command-message>model</command-message><command-args>sonnet</command-args>')).toMatchObject({ summary: '/model sonnet', detail: 'sonnet' });
  });

  it('the output, the caveat, a shell command and its output, a reminder', () => {
    expect(classifyHarnessText('<local-command-stdout>Compacted</local-command-stdout>')).toMatchObject({ label: 'Command output', summary: 'Compacted' });
    expect(classifyHarnessText('<local-command-stderr>boom</local-command-stderr>')).toMatchObject({ label: 'Command error', level: 'error' });
    expect(classifyHarnessText(CAVEAT)).toMatchObject({ label: 'Command caveat' });
    expect(classifyHarnessText('<bash-input> taskkill /F /PID 1</bash-input>')).toMatchObject({ label: 'Shell command', summary: 'taskkill /F /PID 1' });
    expect(classifyHarnessText('<bash-stdout></bash-stdout><bash-stderr>nope</bash-stderr>')).toMatchObject({ label: 'Shell output', level: 'error' });
    expect(classifyHarnessText('<system-reminder>\n<tools-used-before-summary>Grep</tools-used-before-summary>\n</system-reminder>')).toMatchObject({ label: 'System reminder' });
  });

  it('is not harness text when anything else is around, inside an unknown tag, or when it is a genuine prompt', () => {
    expect(classifyHarnessText('please run /compact now')).toBeUndefined();
    expect(classifyHarnessText(`${COMPACT}\nand then tell me a joke`)).toBeUndefined();
    expect(classifyHarnessText('<hc from="t1c">Run exactly this Bash command</hc>')).toBeUndefined();
    expect(classifyHarnessText('<b>bold</b> text')).toBeUndefined();
    expect(classifyHarnessText('')).toBeUndefined();
    expect(classifyHarnessText('   ')).toBeUndefined();
  });
});

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(removeDir));

async function read(lines: Record<string, unknown>[]): Promise<UserPromptEntry[]> {
  const dir = makeTempDir();
  dirs.push(dir);
  const path = join(dir, 's.jsonl');
  writeText(path, jsonl(lines));
  const result = await new TranscriptTailer().readNew(path);
  return result.entries.filter((entry): entry is UserPromptEntry => entry.kind === 'user-prompt');
}

describe('harness text in a transcript', () => {
  it('flags the entries, strips the ANSI escapes (the real bytes carry ESC), and keeps a genuine prompt untouched', async () => {
    const [command, output, caveat, genuine] = await read([humanPrompt(1, COMPACT), humanPrompt(2, COMPACT_OUT), injectedPrompt(3, CAVEAT), humanPrompt(4, 'Please compact the notes')]);
    expect(command?.harness).toMatchObject({ label: 'Command /compact' });
    expect(output?.harness).toMatchObject({ label: 'Command output', summary: 'Compacted (ctrl+o to see full summary)' });
    expect(output?.text).toBe('<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>');
    expect(output?.text).not.toContain(ESC);
    expect(caveat?.harness).toMatchObject({ label: 'Command caveat' });
    expect(genuine?.harness).toBeUndefined();
    expect(genuine?.text).toBe('Please compact the notes');
  });

  it('colour escapes in a genuine prompt are stripped too, and an unknown tag keeps its text visible', async () => {
    const [coloured, unknown] = await read([humanPrompt(1, `${ESC}[31mred${ESC}[0m words`), humanPrompt(2, '<hc from="t1c">Run exactly this</hc>')]);
    expect(coloured?.text).toBe('red words');
    expect(unknown?.harness).toBeUndefined();
    expect(unknown?.text).toBe('<hc from="t1c">Run exactly this</hc>');
  });

  it('a slash command starts no turn and is no prompt of the person', async () => {
    const entries = await read([humanPrompt(1, COMPACT), humanPrompt(2, 'real question')]);
    const activity = new ActivityAccumulator();
    entries.forEach((entry) => activity.add(entry));
    expect(activity.summary().turnsCount).toBe(1);
  });

  it('a task notification is harness text but still starts a turn (only commands and their output do not)', async () => {
    const entries = await read([
      humanPrompt(1, COMPACT),
      humanPrompt(2, COMPACT_OUT),
      taskNotificationPrompt(3, '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>'),
      humanPrompt(4, 'real question'),
    ]);
    expect(entries[2]?.harness?.tags).toContain('task-notification');
    const activity = new ActivityAccumulator();
    entries.forEach((entry) => activity.add(entry));
    expect(activity.summary().turnsCount).toBe(2);
  });
});
