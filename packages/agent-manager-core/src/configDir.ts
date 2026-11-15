import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR_ENV = 'AGENT_MANAGER_CONFIG_DIR';

/**
 * The config folder of the CLI (state, logs, update state and cache): $AGENT_MANAGER_CONFIG_DIR when set and non-blank, else
 * $XDG_CONFIG_HOME/agent-manager, else <home>/.config/agent-manager (`home` defaults to the home directory of the user).
 */
export function defaultConfigDir(env: NodeJS.ProcessEnv, home?: string): string {
  const override = env[CONFIG_DIR_ENV];
  if (override !== undefined && override.trim() !== '') {
    return override;
  }
  const xdg = env['XDG_CONFIG_HOME'];
  return xdg !== undefined && xdg.trim() !== '' ? join(xdg, 'agent-manager') : join(home ?? homedir(), '.config', 'agent-manager');
}
