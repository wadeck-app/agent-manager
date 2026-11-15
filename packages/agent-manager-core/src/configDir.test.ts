import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfigDir } from './configDir.js';

describe('defaultConfigDir', () => {
  it('prefers AGENT_MANAGER_CONFIG_DIR, then XDG_CONFIG_HOME/agent-manager, then ~/.config/agent-manager, ignoring blank values', () => {
    expect(defaultConfigDir({ AGENT_MANAGER_CONFIG_DIR: join('o', 'dir'), XDG_CONFIG_HOME: 'x' }, 'h')).toBe(join('o', 'dir'));
    expect(defaultConfigDir({ XDG_CONFIG_HOME: 'x' }, 'h')).toBe(join('x', 'agent-manager'));
    expect(defaultConfigDir({}, 'h')).toBe(join('h', '.config', 'agent-manager'));
    expect(defaultConfigDir({ AGENT_MANAGER_CONFIG_DIR: '  ', XDG_CONFIG_HOME: ' ' }, 'h')).toBe(join('h', '.config', 'agent-manager'));
  });
});
