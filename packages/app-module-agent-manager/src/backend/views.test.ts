import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { sessionColumns } from './columns.js';
import { presentSession } from './present.js';
import { makeModule } from './testKit.js';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const viewsDir = join(packageDir, 'src/dsl-views');

interface Point {
  kind: string;
  slot: string;
  path?: string;
  label?: string;
  width?: number;
  view: { type: string; value: string };
}
const manifest = JSON.parse(readFileSync(join(packageDir, 'manifest.json'), 'utf8')) as {
  id?: string;
  title?: string;
  extensionPoints: Point[];
  [key: string]: unknown;
};

const viewFiles = readdirSync(viewsDir).filter((file) => /\.ya?ml$/.test(file));

function parseView(file: string): Record<string, unknown> {
  const parsed = load(readFileSync(join(viewsDir, file), 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} must hold a YAML mapping at its root`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

/** Every value stored under `key` at any depth. */
function collect(node: unknown, key: string, found: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, key, found));
  } else if (node !== null && typeof node === 'object') {
    for (const [name, child] of Object.entries(node)) {
      if (name === key) {
        found.push(child);
      }
      collect(child, key, found);
    }
  }
  return found;
}

type UnknownKeyFinder = (doc: unknown, known: unknown) => { severity: string; message: string; nodePath: string }[];

async function unknownKeyTools(): Promise<{ findUnknownKeys: UnknownKeyFinder; knownKeys: unknown }> {
  const require = createRequire(import.meta.url);
  const walker = (await import('@wadeck-app/dsl-renderer/build/unknownKeys')) as { findUnknownKeys: UnknownKeyFinder };
  const knownKeys: unknown = JSON.parse(readFileSync(require.resolve('@wadeck-app/dsl-ui/known-keys.json'), 'utf8'));
  return { findUnknownKeys: walker.findUnknownKeys, knownKeys };
}

describe('manifest.json', () => {
  it('has the id agent-manager and the title Agents, no version and no backend path (the packaging stamps them), and dslLib holds only the shared ranges', () => {
    expect(manifest.id).toBe('agent-manager');
    expect(manifest.title).toBe('Agents');
    for (const key of ['version', 'backendEntryPath']) {
      expect(manifest, key).not.toHaveProperty(key);
    }
    const dslLib = manifest['dslLib'] as { shared?: Record<string, string>; entry?: string; css?: string };
    expect(Object.keys(dslLib)).toEqual(['shared']);
    expect(Object.keys(dslLib.shared ?? {}).sort()).toEqual(['@wadeck-app/dsl-renderer', '@wadeck-app/dsl-ui', 'react', 'react-router-dom']);
  });

  it('declares the Agents page in the menu (/agents), the Table page (/table), the Guardrails page (/guardrails) and one dashboard widget', () => {
    expect(manifest.extensionPoints.map((p) => `${p.kind}:${p.slot}:${p.path ?? '-'}:${p.label}`)).toEqual(['page:nav:/agents:Agents', 'page:nav:/table:Table', 'page:nav:/guardrails:Guardrails', 'widget:dashboard:-:Agents']);
  });

  it('references each view as ./src/dsl-views/<file>, each file exists, and every file of the folder is referenced', () => {
    const referenced = manifest.extensionPoints.map((p) => p.view.value);
    for (const value of referenced) {
      expect(value).toMatch(/^\.\/src\/dsl-views\/[\w.-]+\.ya?ml$/);
      expect(existsSync(join(packageDir, value)), value).toBe(true);
    }
    expect(referenced.map((v) => v.replace('./src/dsl-views/', '')).sort()).toEqual([...viewFiles].sort());
  });

  it('ships its components through dslLib: the entry module exists and every agent-manager:<Name> used by a view is registered by it', () => {
    expect(existsSync(join(packageDir, 'src/dsl-components/index.ts'))).toBe(true);
    const entries = readFileSync(join(packageDir, 'src/dsl-components/generated/entries.tsx'), 'utf8');
    const registered = [...entries.matchAll(/name: '(\w+)'/g)].map((match) => match[1]);
    const used = viewFiles.flatMap((file) => collect(parseView(file), '$type')).filter((type): type is string => typeof type === 'string' && type.startsWith('agent-manager:'));
    expect(used.length, 'no view uses a component of the module').toBeGreaterThan(0);
    for (const type of used) {
      expect(registered, `${type} is not registered: run npm run entries`).toContain(type.slice('agent-manager:'.length));
    }
  });
});

describe('dsl-views', () => {
  it.each(viewFiles)('%s parses and has a $type', (file) => {
    expect(parseView(file)['$type']).toEqual(expect.any(String));
  });

  // The components of the module itself (agent-manager:<Name>) are not in the dsl-ui key file: their props are checked by the generated entry (knownKeys) and by the tests of the component.
  it.each(viewFiles)('%s holds only keys the installed dsl-ui knows', async (file) => {
    const { findUnknownKeys, knownKeys } = await unknownKeyTools();
    const errors = findUnknownKeys(parseView(file), knownKeys).filter((d) => d.severity === 'error' && !/agent-manager:/.test(d.message));
    expect(errors, errors.map((d) => `${d.nodePath} ${d.message}`).join('\n')).toEqual([]);
  });

  // Guards against a check that passes because it checks nothing (a renamed export, an empty key file).
  it('the key check does flag an unknown key and an unknown component', async () => {
    const { findUnknownKeys, knownKeys } = await unknownKeyTools();
    const found = findUnknownKeys({ $type: 'PageContent', sections: [{ $type: 'Badge', label: 'x', colour: 'red' }, { $type: 'NoSuchThing' }] }, knownKeys);
    expect(found.filter((d) => d.severity === 'error').length).toBeGreaterThanOrEqual(2);
  });

  it.each(viewFiles)('%s is English and ASCII only (UI texts and comments)', (file) => {
    const text = readFileSync(join(viewsDir, file), 'utf8');
    // eslint-disable-next-line no-control-regex
    expect(text.replace(/[\x00-\x7f]/g, '')).toBe('');
  });

  const routes = makeModule().routes;
  const urlsOf = (file: string, key: '$sources' | '$actions'): { name: string; method: string; path: string; url: string }[] => {
    const block = (parseView(file)[key] ?? {}) as Record<string, { url: string }>;
    return Object.entries(block).map(([name, spec]) => {
      const [method = '', rest = ''] = spec.url.split(' ');
      return { name, method, path: rest.replace(/^\/api\/modules\/agent-manager/, '').split('?')[0]!, url: rest };
    });
  };
  const shape = (path: string): string => path.replace(/\{[^}]+\}/g, ':ref');

  it.each(viewFiles)('%s: every source and action calls a route the module registers (same method, same shape)', (file) => {
    const calls = [...urlsOf(file, '$sources'), ...urlsOf(file, '$actions')].filter((c) => c.url.startsWith('/api/modules/agent-manager'));
    expect(calls.length, `${file} has no call to the module: a view that reads nothing is a mistake here`).toBeGreaterThan(0);
    for (const call of calls) {
      expect(routes.map((route) => route.replace(/:[A-Za-z]+/g, ':ref')), `${file} ${call.name}: ${call.method} ${call.path}`).toContain(`${call.method} ${shape(call.path)}`);
    }
  });

  // The shell glues the params to the url with '?': a url that already has a query AND params became 'a?x=1?label=..' (seen in a browser).
  it.each(viewFiles)('%s: the sources answer errors as data (inlineErrors), so that one failure does not blank the page', (file) => {
    const sources = (parseView(file)['$sources'] ?? {}) as Record<string, { url: string; params?: Record<string, unknown> }>;
    for (const [name, source] of Object.entries(sources).filter(([, spec]) => spec.url.includes('/api/modules/agent-manager'))) {
      const hasParams = Object.keys(source.params ?? {}).some((key) => key !== 'inlineErrors' && !source.url.includes(`{${key}}`));
      if (hasParams && source.url.includes('?')) {
        throw new Error(`${file} ${name}: a url with a query string and params break in the shell; move the query into params`);
      }
      const inline = source.url.includes('inlineErrors=true') || source.params?.['inlineErrors'] === 'true';
      expect(inline, `${file} ${name}`).toBe(true);
    }
  });

  it.each(viewFiles)('%s: every source polls every 5 s (the registry changes without any event in M1b)', (file) => {
    const sources = Object.values((parseView(file)['$sources'] ?? {}) as Record<string, { poll?: string }>);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.poll).toBe('5s');
    }
  });

  // A link to a page of this module must land on a page the manifest declares (a typo would give a blank "not found" page in the shell).
  it.each(viewFiles)('%s: every link to this module lands on a page of the manifest', (file) => {
    const pages = manifest.extensionPoints.filter((p) => p.kind === 'page' && p.path !== undefined).map((p) => `/modules/${manifest.id}${p.path === '/' ? '' : p.path}`);
    const links = [...collect(parseView(file), 'href'), ...collect(parseView(file), 'to')].filter((v): v is string => typeof v === 'string' && v.startsWith('/modules/'));
    for (const link of links) {
      const path = link.split('?')[0]!;
      const matches = pages.some((page) => new RegExp(`^${page.replace(/:[A-Za-z0-9_-]+/g, '[^/]+')}$`).test(path));
      expect(matches, `${file}: ${link} is not a page of the manifest (${pages.join(', ')})`).toBe(true);
    }
  });
});

describe('the Agents page', () => {
  const page = (): Record<string, unknown> => parseView('sessions-page.yaml');
  const sections = (): Record<string, unknown>[] => (page()['sections'] as Record<string, unknown>[]) ?? [];

  it('is the master-detail workspace, with no A/B test of the layout (the mode is a toggle inside the component)', () => {
    expect(sections().filter((s) => s['$type'] === 'AbTest')).toEqual([]);
    const workspace = sections().filter((s) => s['$type'] === 'agent-manager:AgentWorkspace');
    expect(workspace).toHaveLength(1);
    // It gets the rows of the page source (no second request) and its own props only.
    expect(workspace[0]).toEqual({ $type: 'agent-manager:AgentWorkspace', $if: '$sources.sessions.ok', sessions: '$sources.sessions.sessions', userStateError: '$sources.sessions.userStateError', customGroups: '$sources.sessions.customGroups', hiddenDead: '$sources.sessions.hiddenDead', ownedError: '$sources.sessions.ownedError', ownedErrorText: '$sources.sessions.ownedErrorText', unreadableText: '$sources.sessions.unreadableText', guardrailsErrorText: '$sources.sessions.guardrailsErrorText', ownedDownText: '$sources.sessions.ownedDownText', ownedStateErrorText: '$sources.sessions.ownedStateErrorText' });
    expect(readFileSync(join(viewsDir, 'sessions-page.yaml'), 'utf8')).not.toMatch(/sessions-layout|layout-(groups|inbox|tree|cards|palette)-style|DataTable/);
  });

  it('uses the full page width (the workspace stretches itself over the frame padding)', () => {
    expect(page()['maxWidth']).toBe('full');
  });

  it('keeps no trace of the removed herdr layout', () => {
    expect(readFileSync(join(viewsDir, 'sessions-page.yaml'), 'utf8')).not.toMatch(/herdrError|\$sources\.sessions\.herdr\b|pinSession|markSeen/);
  });

  it('the dead sessions filter is a URL parameter (show) that reaches the source, default alive', () => {
    const sources = page()['$sources'] as Record<string, { params: Record<string, string> }>;
    expect(sources['sessions']?.params['show']).toBe('$urlParam.show');
    // The filter itself is in the workspace toolbar (useUrlParam('show')) and on the table page (CompactSelect urlParam).
    expect(collect(parseView('sessions-table.yaml'), 'urlParam')).toContain('show');
  });

  it('shows the status as a badge with semantic variants, never a raw colour, and dates through the shell formatter', () => {
    // The columns are built by the route (the Harness badge map depends on the versions found on this machine): the view only points at them.
    const page = readFileSync(join(viewsDir, 'sessions-table.yaml'), 'utf8');
    expect(page).toContain('columns: $sources.sessions.tableColumns');
    const columns = sessionColumns([]);
    const byKey = Object.fromEntries(columns.map((column) => [String(column.key), column]));
    expect(byKey.statusUpdatedAt?.format).toBe('datetime');
    expect(byKey.statusGroup?.badge).toEqual({ busy: 'info', idle: 'success', other: 'warning' });
    expect(byKey.harness?.label).toBe('Harness');
    expect(JSON.stringify(columns) + page).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(|bg-[a-z]+-\d{3}/);
  });

  it('surfaces the errors and the unreadable files as badges, not as an empty list', () => {
    const text = readFileSync(join(viewsDir, 'sessions-page.yaml'), 'utf8');
    expect(text).toContain('$sources.sessions.errorText');
    expect(text).toContain('$sources.sessions.unreadableText');
  });
});

describe('the Agents table page', () => {
  const table = (): Record<string, unknown> => parseView('sessions-table.yaml');
  const sections = (): Record<string, unknown>[] => (table()['sections'] as Record<string, unknown>[]) ?? [];

  it('says on the page itself what feeds it today: registry plus daemon-owned sessions, hooks not built, SSE not used by the table', () => {
    const note = sections().flatMap((s) => collect(s, 'text'));
    expect(note).toContain('Sessions from the Claude Code registry (pid-only liveness) and the sessions owned by the agent-manager daemon, refreshed every 5 seconds. The log, the replies and the launch actions are on the Agents page. Hooks are not built yet; the daemon host API and its live updates (SSE) exist but this table does not use them.');
    expect(note.join(' ')).not.toMatch(/M1b|planned/);
  });

  it('holds the table of the sessions and the dead-session filter, with no button back (the side menu is the way)', () => {
    expect(sections().some((s) => s['$type'] === 'DataTable' && s['rows'] === '$sources.sessions.sessions')).toBe(true);
    expect(collect(table(), 'urlParam')).toContain('show');
    expect(JSON.stringify(table())).not.toContain('ButtonLink');
  });

  it('reads the same source as the Agents page (same URL and parameters), errors answered as data', () => {
    const own = table()['$sources'] as Record<string, { url: string; params: Record<string, string> }>;
    const other = parseView('sessions-page.yaml')['$sources'] as Record<string, { url: string; params: Record<string, string> }>;
    expect(own['sessions']).toEqual(other['sessions']);
    expect(own['sessions']?.params['inlineErrors']).toBe('true');
  });
});
