import { execFile } from 'node:child_process';
import { getErrorMessage } from '../../errors.js';
import { LaunchError } from '../errors.js';
import { DEFAULT_CLAUDE_COMMAND } from '../StreamJsonSession.js';

export const DEFAULT_VERSION_TIMEOUT_MS = 15_000;

export interface ClaudeVersionOptions {
  command?: string;
  commandArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * `claude --version` of the program the daemon will start (decision L5: the version is recorded at launch and shown). Started without a shell. A
 * program that is missing, fails, times out or prints nothing is an error with a fix: a launch never goes on with a claude that does not answer.
 */
export async function readClaudeVersion(options: ClaudeVersionOptions = {}): Promise<string> {
  const command = options.command ?? DEFAULT_CLAUDE_COMMAND;
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    execFile(command, [...(options.commandArgs ?? []), '--version'], { env: options.env ?? process.env, timeout: timeoutMs, windowsHide: true, shell: false, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      if (error !== null) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          reject(new LaunchError('claude-missing', `the program '${command}' was not found`, 'install Claude Code and put `claude` on the PATH of the process that runs the agent-manager daemon (check with: claude --version)'));
        } else {
          const detail = (stderr.trim() || getErrorMessage(error)).slice(0, 300);
          reject(new LaunchError('claude-version-failed', `'${command} --version' failed (${detail})`, `check that \`claude --version\` works in a terminal with the same environment as the daemon (timeout ${timeoutMs} ms), then retry`));
        }
        return;
      }
      const version = stdout.trim().split(/\r?\n/)[0]?.trim() ?? '';
      if (version === '') {
        reject(new LaunchError('claude-version-empty', `'${command} --version' printed nothing`, 'check that the program is Claude Code (claude --version in a terminal)'));
        return;
      }
      resolve(version.slice(0, 100));
    });
  });
}
