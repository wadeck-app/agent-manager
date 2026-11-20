import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { getErrorMessage } from '../errors.js';
import { ReplyError } from './errors.js';

/*
 * The process runner of herdr-core's `hc`, shared by the hc reply transport and the hc launcher: argument array (never a shell), no stdin,
 * HC_TERMINAL_ID removed from the environment of the child, bounded output, a timeout that stops the child, and the error mapping
 * (missing program, cannot start, timeout, output too large). Whoever calls it decides what the exit code and the JSON mean.
 */

export const DEFAULT_HC_COMMAND = 'hc';
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
/** Environment variable that makes hc add a `<hc from="tN">` tag around the text: removed from the child. */
const CALLER_VARIABLE = 'HC_TERMINAL_ID';

export const HC_MISSING_FIX = 'install herdr-core and put `hc` on the PATH of the process that runs agent-manager (check with: hc --version); or select the socket transport';

export interface HcRunnerOptions {
  /** Program to run. Default 'hc' (found on the PATH, started without a shell). */
  command?: string;
  /** Arguments put before the hc arguments (a test runs `node fake-hc.mjs`). */
  commandArgs?: readonly string[];
  /** The environment hc inherits, minus HC_TERMINAL_ID. Default: process.env at each call. */
  env?: () => NodeJS.ProcessEnv;
}

export interface HcRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** What hc says when it refuses: `{"error":{"kind","message","hint"}}`. */
export interface HcFailure {
  kind: string;
  message: string;
  hint: string;
}

export interface HcRunner {
  readonly command: string;
  /** Starts hc with an argument array (no shell). Throws a ReplyError when hc is missing, cannot start, or does not end within the timeout. */
  run(args: readonly string[], timeoutMs: number, what: string, timeoutFix?: string): Promise<HcRun>;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}

export function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The environment of the child: the given one without HC_TERMINAL_ID (any case), so that hc adds no `<hc from=...>` tag. */
export function childEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && name.toUpperCase() !== CALLER_VARIABLE) {
      env[name] = value;
    }
  }
  return env;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function failureOf(run: HcRun): HcFailure | undefined {
  for (const text of [run.stdout, run.stderr]) {
    const error = asRecord(asRecord(parseJson(text.trim()))?.['error']);
    if (error !== undefined) {
      return { kind: asText(error['kind']) ?? 'unknown', message: asText(error['message']) ?? '(no message)', hint: asText(error['hint']) ?? '' };
    }
  }
  return undefined;
}

export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}...` : flat;
}

export function createHcRunner(options: HcRunnerOptions = {}): HcRunner {
  const command = options.command ?? DEFAULT_HC_COMMAND;
  const commandArgs = options.commandArgs ?? [];
  const environment = options.env ?? ((): NodeJS.ProcessEnv => process.env);

  function run(args: readonly string[], timeoutMs: number, what: string, timeoutFix?: string): Promise<HcRun> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      let overflow = false;
      const child = spawn(command, [...commandArgs, ...args], { env: childEnvironment(environment()), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
      const finish = (action: () => void): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          action();
        }
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new ReplyError('hc-timeout', `hc did not answer within ${timeoutMs} ms (${what}); it was stopped`, timeoutFix ?? 'check that herdr-core is running (hc server status), then retry')));
      }, timeoutMs);
      // One decoder and one byte counter per stream: a multi-byte character split between two chunks is kept whole, the cap counts bytes, and
      // once it is exceeded nothing more is collected (the child is stopped, its close then reports the overflow).
      const collector = (append: (text: string) => void): ((chunk: Buffer) => void) => {
        const decoder = new StringDecoder('utf8');
        let bytes = 0;
        return (chunk) => {
          if (overflow) {
            return;
          }
          bytes += chunk.length;
          if (bytes > MAX_OUTPUT_BYTES) {
            overflow = true;
            child.kill();
            return;
          }
          append(decoder.write(chunk));
        };
      };
      child.stdout.on('data', collector((text) => {
        stdout += text;
      }));
      child.stderr.on('data', collector((text) => {
        stderr += text;
      }));
      child.once('error', (error: NodeJS.ErrnoException) => {
        finish(() => {
          if (error.code === 'ENOENT') {
            reject(new ReplyError('hc-missing', `the program '${command}' was not found (${what})`, HC_MISSING_FIX));
          } else {
            reject(new ReplyError('hc-cannot-start', `the program '${command}' cannot be started (${error.code ?? 'error'}: ${getErrorMessage(error)})`, HC_MISSING_FIX));
          }
        });
      });
      child.once('close', (code) => {
        finish(() => {
          if (overflow) {
            reject(new ReplyError('hc-output-too-large', `hc printed more than ${MAX_OUTPUT_BYTES} bytes (${what})`, 'report this: the hc output format changed'));
          } else {
            resolve({ code, stdout, stderr });
          }
        });
      });
    });
  }

  return { command, run };
}
