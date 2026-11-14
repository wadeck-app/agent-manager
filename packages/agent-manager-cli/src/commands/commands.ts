import type { Command } from '../command.js';
import { CLI_COMMANDS } from './cli.js';
import { startCommand, statusCommand, stopCommand } from './daemon.js';

export const COMMANDS: Command[] = [startCommand, stopCommand, statusCommand, ...CLI_COMMANDS];
