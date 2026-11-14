import type { OptionSpecs } from './args.js';
import type { Command } from './command.js';
import { globalOptions, optionsOf } from './options.js';

const SUMMARY = 'agent-manager - follow and answer your Claude Code sessions (M1b partial slice: only a sessions overview in app-core, from the Claude Code registry; daemon, hooks, transcripts and replies are not implemented)';
const CONFIG_NOTE = 'The config folder is $AGENT_MANAGER_CONFIG_DIR, else $XDG_CONFIG_HOME/agent-manager, else ~/.config/agent-manager.';

/** `<name> [other]`: the positional arguments of a command. */
export function argsSyntax(command: Command): string {
  return [...command.args.map((a) => `<${a}>`), ...(command.optionalArgs ?? []).map((a) => `[${a}]`)].join(' ');
}

/** `agent-manager cli update` */
export function usageLine(command: Command): string {
  return `agent-manager ${command.name} ${argsSyntax(command)}`.trimEnd();
}

function optionLines(specs: OptionSpecs): string[] {
  const rows = Object.entries(specs).map(([name, spec]) => {
    const short = spec.short === undefined ? '    ' : `-${spec.short}, `;
    const value = spec.type === 'boolean' ? '' : ` <${spec.valueName ?? name}>`;
    return { left: `${short}--${name}${value}`, description: spec.description };
  });
  const width = Math.max(...rows.map((row) => row.left.length));
  return rows.map((row) => `  ${row.left.padEnd(width)}  ${row.description}`);
}

function commandLines(commands: readonly Command[]): string[] {
  const width = Math.max(...commands.map((c) => usageLine(c).length));
  return commands.map((c) => `  ${usageLine(c).padEnd(width)}  ${c.summary}`);
}

export function topHelp(commands: readonly Command[]): string[] {
  return [
    SUMMARY,
    '',
    'Usage: agent-manager <command> [options]',
    '',
    'Commands:',
    ...commandLines(commands),
    '',
    'Options (all commands):',
    ...optionLines({ ...globalOptions(), version: { type: 'boolean', short: 'v', description: 'Print the version (without a command)' } }),
    '',
    "Run 'agent-manager <command> --help' for the options of one command.",
    CONFIG_NOTE,
  ];
}

export function groupHelp(group: string, commands: readonly Command[]): string[] {
  return [`Usage: agent-manager ${group} <subcommand>`, '', 'Subcommands:', ...commandLines(commands.filter((c) => c.name.startsWith(`${group} `)))];
}

export function commandHelp(command: Command): string[] {
  return [`Usage: ${usageLine(command)} [options]`, '', command.summary, '', 'Options:', ...optionLines(optionsOf(command))];
}
