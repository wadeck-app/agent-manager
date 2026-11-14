import type { Options, OptionSpecs } from './args.js';
import type { InvocationLog } from './invocationLog.js';

/** Where the CLI writes: one line per call, the newline is added by the writer. */
export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** What a command produced: the same result as a machine value (--json) and as human lines. */
export interface CommandOutput {
  json: unknown;
  lines: string[];
}

export interface Context {
  io: Io;
  env: NodeJS.ProcessEnv;
  cwd: string;
  configDir: string;
  options: Options;
  log: InvocationLog;
}

/** A command. Its name is the full name: `start`, `cli update`. */
export interface Command {
  name: string;
  summary: string;
  options: OptionSpecs;
  /** Required positional arguments. */
  args: string[];
  optionalArgs?: string[];
  run: (context: Context, args: string[]) => CommandOutput | Promise<CommandOutput>;
}
