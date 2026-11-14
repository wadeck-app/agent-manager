import { homedir } from 'node:os';
import { join } from 'node:path';

export const SESSIONS_DIR_ENV = 'AGENT_MANAGER_SESSIONS_DIR';

/**
 * The folder Claude Code writes its session registry in: $AGENT_MANAGER_SESSIONS_DIR when set and non-blank, else
 * <home>/.claude/sessions (`home` defaults to the home directory of the user).
 */
export function resolveSessionsDir(env: NodeJS.ProcessEnv, home?: string): string {
  const override = env[SESSIONS_DIR_ENV];
  if (override !== undefined && override.trim() !== '') {
    return override;
  }
  return join(home ?? homedir(), '.claude', 'sessions');
}
