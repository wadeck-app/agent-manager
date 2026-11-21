// @vitest-environment node
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateEntries, relocateImports } from './generate-entries.js';
import { LIB_ENTRIES } from './paths.js';

describe('generated entries', () => {
  const generated = generateEntries();

  it('registers AgentWorkspace with its props (the rows come from the page source) and imports the component from the folder next to it', () => {
    expect(generated).toContain('AgentWorkspaceEntry');
    expect(generated).toContain('"customGroups","guardrailsErrorText","hiddenDead","ownedError","ownedErrorText","sessions","unreadableText","userStateError"');
    expect(generated).not.toContain('../dsl-components/');
    expect(generated).toContain("from '../components/AgentWorkspace.js'");
  });

  it('src/dsl-components/generated/entries.tsx is not stale', () => {
    expect(fs.existsSync(LIB_ENTRIES), `${LIB_ENTRIES} is missing: run "npm run entries" in packages/app-module-agent-manager`).toBe(true);
    expect(fs.readFileSync(LIB_ENTRIES, 'utf8').replace(/\r\n/g, '\n'), 'stale: run "npm run entries" in packages/app-module-agent-manager').toBe(generated.replace(/\r\n/g, '\n'));
  });

  it('fails loudly when the generator output has no import to relocate', () => {
    expect(() => relocateImports("import x from './elsewhere.js'")).toThrow(/adapt relocateImports/);
  });
});
