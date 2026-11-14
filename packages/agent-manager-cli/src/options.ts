import type { OptionSpecs } from './args.js';
import type { Command } from './command.js';

const COMMON_OPTIONS: OptionSpecs = {
  json: { type: 'boolean', description: 'Print the result as JSON on stdout' },
  help: { type: 'boolean', short: 'h', description: 'Show this help' },
};

/** Every option a command accepts: its own, then --json and --help. */
export function optionsOf(command: Command): OptionSpecs {
  return { ...command.options, ...COMMON_OPTIONS };
}

/** The options shown in the top-level help (those every command shares). */
export function globalOptions(): OptionSpecs {
  return COMMON_OPTIONS;
}
