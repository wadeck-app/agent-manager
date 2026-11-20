import { parseArgs } from './args.js';
import type { Command, CommandOutput, Context, Io } from './command.js';
import { COMMANDS } from './commands/commands.js';
import { defaultConfigDir } from './configDir.js';
import { type Dispatch, splitCommand } from './dispatch.js';
import { EXIT } from './exitCodes.js';
import { CliError, UsageError, getErrorMessage } from './errors.js';
import { argsSyntax, commandHelp, groupHelp, topHelp } from './help.js';
import { type InvocationLog, openInvocationLog } from './invocationLog.js';
import { optionsOf } from './options.js';
import { currentVersion } from './version.js';


function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

function print(io: Io, lines: readonly string[]): number {
  lines.forEach((line) => io.out(line));
  return 0;
}

/** Handles argv that did not name a command: --version, --help, a group, or a mistake. */
function withoutCommand(argv: readonly string[], dispatch: Dispatch, io: Io): number {
  const [first, second] = dispatch.words;
  if (first === undefined) {
    if (argv.includes('--version') || argv.includes('-v')) {
      return print(io, [currentVersion()]);
    }
    if (wantsHelp(argv)) {
      return print(io, topHelp(COMMANDS));
    }
    throw new UsageError('no command given');
  }
  const subcommands = COMMANDS.filter((c) => c.name.startsWith(`${first} `)).map((c) => c.name.slice(first.length + 1));
  if (subcommands.length === 0) {
    throw new UsageError(`unknown command '${first}'`);
  }
  if (second === undefined && wantsHelp(argv)) {
    return print(io, groupHelp(first, COMMANDS));
  }
  const expected = subcommands.join(', ');
  throw new UsageError(
    second === undefined ? `'${first}' needs a subcommand: ${expected}` : `unknown subcommand '${second}' for '${first}': expected ${expected}`,
    `agent-manager ${first}`,
  );
}

/** Checks the positionals against the syntax of the command, or fails with the expected syntax. */
function checkPositionals(command: Command, positionals: readonly string[]): string[] {
  const min = command.args.length;
  const max = min + (command.optionalArgs?.length ?? 0);
  if (positionals.length < min || positionals.length > max) {
    const given = positionals.length === 0 ? 'none' : positionals.map((p) => `'${p}'`).join(', ');
    throw new UsageError(`expected ${argsSyntax(command) || 'no argument'}, got ${given}`, `agent-manager ${command.name}`);
  }
  return [...positionals];
}

async function execute(command: Command, rest: readonly string[], io: Io, env: NodeJS.ProcessEnv, cwd: string, log: InvocationLog): Promise<number> {
  const label = `agent-manager ${command.name}`;
  const parsed = parseArgs(rest, optionsOf(command), label);
  if (parsed.options.flag('help')) {
    return print(io, commandHelp(command));
  }
  const args = checkPositionals(command, parsed.positionals);
  const context: Context = { io, env, cwd, configDir: defaultConfigDir(env), options: parsed.options, log };
  const output: CommandOutput = await command.run(context, args);
  if (parsed.options.flag('json')) {
    // A command that wrote its own output has no result to print.
    return print(io, output.json === undefined ? [] : [JSON.stringify(output.json, null, 2)]);
  }
  return print(io, output.lines);
}

interface Failure {
  exitCode: number;
  /** Stable identifier of the failure, written to the log. */
  code: string;
}

function report(error: unknown, io: Io): Failure {
  if (error instanceof UsageError) {
    io.err(`error: ${getErrorMessage(error)}`);
    io.err(`Run '${error.command} --help' for usage.`);
    return { exitCode: EXIT.usage, code: 'USAGE' };
  }
  if (error instanceof CliError) {
    io.err(`error: ${getErrorMessage(error)}`);
    return { exitCode: error.exitCode, code: error.logCode };
  }
  io.err('unexpected error (this is a bug of the agent-manager CLI, please report it with the output below):');
  io.err(error instanceof Error ? (error.stack ?? String(error)) : String(error));
  return { exitCode: EXIT.unexpected, code: 'UNEXPECTED' };
}

/**
 * Runs the CLI and returns the exit code: 0 success, 1 a CliError (3 when the daemon is unreachable: see exitCodes.ts), 2 a usage error, 70 an unexpected exception.
 * Never touches `process`: the caller supplies argv, the writers, the environment and the working directory.
 * Every invocation is logged in <config folder>/logs (see invocationLog.ts).
 */
export async function run(argv: readonly string[], io: Io, env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const log = openInvocationLog(defaultConfigDir(env), argv, (reason) => io.err(`warning: could not write the log (${reason})`));
  try {
    const dispatch = splitCommand(argv, COMMANDS.map((c) => c.name));
    const command = COMMANDS.find((c) => c.name === dispatch.name);
    const exitCode = command === undefined ? withoutCommand(argv, dispatch, io) : await execute(command, dispatch.rest, io, env, cwd, log);
    log.outcome(exitCode);
    return exitCode;
  } catch (error) {
    const failure = report(error, io);
    log.outcome(failure.exitCode, failure.code);
    return failure.exitCode;
  }
}
