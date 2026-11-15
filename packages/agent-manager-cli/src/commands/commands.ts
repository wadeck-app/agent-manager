import type { Command } from '../command.js';
import { CLI_COMMANDS } from './cli.js';
import { startCommand, statusCommand, stopCommand } from './daemon.js';
import { TRANSPORT_COMMANDS } from './transport.js';

export const COMMANDS: Command[] = [startCommand, stopCommand, statusCommand, ...TRANSPORT_COMMANDS, ...CLI_COMMANDS];
