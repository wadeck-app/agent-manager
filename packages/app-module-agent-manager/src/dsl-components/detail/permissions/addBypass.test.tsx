import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// violations-suppress: ts/no-deep-relative test fixtures of the logic folder
import { overview } from '../../logic/permissionsFixtures.js';
// violations-suppress: ts/no-deep-relative test fixtures of the owned folder
import { stubFetch } from '../../owned/testFetch.js';
import { permissionsOf, row } from '../deps.js';
import type { CliGrantDto, RuleCategoryDto, SessionGrantsDto, SessionRulesDto } from '../deps.js';
import { PermissionsPanel } from './PermissionsPanel.js';
import type { CliGrantsState, SessionGrantsFeed } from './useSessionGrants.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const SID = '00000000-0000-4000-8000-000000000001';
const session = row({ sessionId: SID, cwd: '/w/shop', displayName: 'shop-owner' });
const cliGrant = (id: string, over: Partial<CliGrantDto> = {}): CliGrantDto => ({ id, category: 'rm', mode: 'once', sessionId: SID, expiresAt: Date.now() + 600_000, remainingMs: 600_000, remainingText: '10 min', usesLeft: 1, reason: 'clean', origin: null, ...over });
const data = (grants: CliGrantDto[]): SessionGrantsDto => ({ ok: true, code: '', sessionId: SID, cwd: '/w/shop', cwdNote: '', grants, errorText: '' });

function feed(cli: CliGrantsState, extra: Partial<SessionGrantsFeed> = {}): SessionGrantsFeed {
  const files = overview([]);
  return { overview: files, view: permissionsOf(files, SID, session.cwd), error: '', loading: false, reload: vi.fn(), cli, ...extra };
}

const rule = (name: string, over: Partial<RuleCategoryDto> = {}): RuleCategoryDto => ({ name, decision: 'deny', source: 'default', bypassable: true, hardcoded: false, ...over });
const rules = (over: Partial<SessionRulesDto> = {}): SessionRulesDto => ({
  ok: true,
  code: '',
  sessionId: SID,
  cwd: '/w/shop',
  cwdNote: '',
  configPath: '/w/shop/.claude/guardrails.json',
  configPresent: false,
  configError: '',
  categories: [rule('rm'), rule('git-push', { decision: 'ask', source: 'config' }), rule('ssh-config', { bypassable: false, hardcoded: true, source: 'hardcoded' })],
  errorText: '',
  ...over,
});

const CSRF = { 'GET /csrf': { body: { header: 'x-agent-manager-csrf', token: 't' } } };
const RULES = `GET /guardrails/sessions/${SID}/rules`;
const ADD = `POST /guardrails/sessions/${SID}/grants`;
const added = { ok: true, id: 'c0ffee01', category: 'rm', mode: '10m', sessionId: SID, cwd: '/w/shop', expiresAt: Date.now() + 600_000, origin: 'ui', auditError: '' };

const okCli = (grants: CliGrantDto[] = []): CliGrantsState => ({ kind: 'ok', data: data(grants) });

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Add bypass' }));
  return screen.findByRole('dialog', { name: 'Add a bypass' });
}

describe('Add bypass: the control', () => {
  it('is enabled when the admin CLI answers, and opens the dialog; no flag, no tooltip about a pending API', async () => {
    stubFetch({ ...CSRF, [RULES]: { body: rules() } });
    render(<PermissionsPanel session={session} feed={feed(okCli())} />);
    expect(screen.getByRole('button', { name: 'Add bypass' })).toBeEnabled();
    expect(document.querySelector('[data-write-control]')).toBeNull();
    await openDialog();
  });

  it('is off, with the reason in words, when the admin CLI is not installed (nothing can grant without it)', () => {
    stubFetch({ ...CSRF, [RULES]: { body: rules() } });
    render(<PermissionsPanel session={session} feed={feed({ kind: 'missing', text: 'w-guardrails is not installed (looked in C:\\x).' })} />);
    expect(screen.getByRole('button', { name: 'Add bypass' })).toBeDisabled();
    expect(screen.getByText(/Add bypass needs the w-guardrails admin CLI/)).toBeInTheDocument();
  });
});

describe('Add bypass: the dialog', () => {
  it('lists only the bypassable categories with their current decision, the four modes with once selected, and asks for a reason', async () => {
    stubFetch({ ...CSRF, [RULES]: { body: rules() } });
    render(<PermissionsPanel session={session} feed={feed(okCli())} />);
    const dialog = await openDialog();
    const select = await within(dialog).findByLabelText(/Category/);
    await waitFor(() => expect(within(select).getAllByRole('option').map((option) => option.textContent)).toContain('rm: denied (default)'));
    const labels = within(select).getAllByRole('option').map((option) => option.textContent);
    expect(labels).toContain('git-push: asks (config)');
    expect(labels.join('|')).not.toContain('ssh-config');
    const modes = within(dialog).getByRole('group', { name: 'Duration' });
    expect(within(modes).getAllByRole('button').map((button) => button.textContent)).toEqual(['once', '10 min', '30 min', '4 h']);
    expect(within(modes).getByRole('button', { name: 'once' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByText(/stored as plain text/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add bypass' })).toBeDisabled();
  });

  it('the confirm line names the category, the duration, the session and the folder, and follows the choices', async () => {
    stubFetch({ ...CSRF, [RULES]: { body: rules() } });
    render(<PermissionsPanel session={session} feed={feed(okCli())} />);
    const dialog = await openDialog();
    await within(dialog).findByText('Allow rm once in shop-owner (/w/shop)');
    fireEvent.click(within(dialog).getByRole('button', { name: '30 min' }));
    expect(within(dialog).getByText('Allow rm for 30 min in shop-owner (/w/shop)')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Category/), { target: { value: 'git-push' } });
    expect(within(dialog).getByText('Allow git-push for 30 min in shop-owner (/w/shop)')).toBeInTheDocument();
  });

  it('a reason that is too long or has a line break keeps the button off and says why', async () => {
    stubFetch({ ...CSRF, [RULES]: { body: rules() } });
    render(<PermissionsPanel session={session} feed={feed(okCli())} />);
    const dialog = await openDialog();
    await within(dialog).findByText(/Allow rm once/);
    const reason = within(dialog).getByLabelText(/Reason/);
    fireEvent.change(reason, { target: { value: 'x'.repeat(301) } });
    expect(within(dialog).getByText('The reason has 301 characters, the limit is 300.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add bypass' })).toBeDisabled();
    fireEvent.change(reason, { target: { value: 'clean the build folder' } });
    expect(within(dialog).getByRole('button', { name: 'Add bypass' })).toBeEnabled();
  });

  it('submits category, mode and reason only (through the PIN fetcher), then closes, says what was added and reloads the list', async () => {
    const reload = vi.fn();
    const { calls } = stubFetch({ ...CSRF, [RULES]: { body: rules() }, [ADD]: { body: added } });
    render(<PermissionsPanel session={session} feed={feed(okCli(), { reload })} />);
    const dialog = await openDialog();
    await within(dialog).findByText(/Allow rm once/);
    fireEvent.click(within(dialog).getByRole('button', { name: '10 min' }));
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'clean the build folder' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add bypass' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a bypass' })).toBeNull());
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ category: 'rm', mode: '10m', rationale: 'clean the build folder' });
    expect(screen.getByRole('status')).toHaveTextContent('Added a rm bypass for 10 min (c0ffee01). It is listed below.');
    expect(reload).toHaveBeenCalled();
  });

  it('a refusal (PIN expired, not bypassable ...) is an alert in the dialog with the server text; the dialog stays, nothing claims success', async () => {
    const reload = vi.fn();
    stubFetch({ ...CSRF, [RULES]: { body: rules() }, [ADD]: { status: 409, body: { ok: false, error: { code: 'pin-expired', message: 'The PIN was entered more than 10 minutes ago: enter it again and retry', hint: 'The plugin said: elevation-required' } } } });
    render(<PermissionsPanel session={session} feed={feed(okCli(), { reload })} />);
    const dialog = await openDialog();
    await within(dialog).findByText(/Allow rm once/);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'because' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add bypass' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('The PIN was entered more than 10 minutes ago: enter it again and retry. The plugin said: elevation-required');
    expect(screen.getByRole('dialog', { name: 'Add a bypass' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    // The reason stays: a retry is one click.
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue('because');
  });

  it('an audit warning of the server is shown next to the success', async () => {
    stubFetch({ ...CSRF, [RULES]: { body: rules() }, [ADD]: { body: { ...added, auditError: 'The audit line could not be written to /c/audit: EACCES. The bypass state is as the plugin left it.' } } });
    render(<PermissionsPanel session={session} feed={feed(okCli())} />);
    const dialog = await openDialog();
    await within(dialog).findByText(/Allow rm once/);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'because' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add bypass' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a bypass' })).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Added a rm bypass');
    expect(screen.getByRole('alert')).toHaveTextContent('The audit line could not be written');
  });

  it('the rules that cannot be read are said in the dialog and the submit stays off', async () => {
    stubFetch({ ...CSRF, [RULES]: { body: rules({ ok: false, code: 'bad-output', categories: [], errorText: 'The w-guardrails admin CLI answered something that is not its contract. Update the plugin.' }) } });
    render(<PermissionsPanel session={session} feed={feed(okCli())} />);
    const dialog = await openDialog();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The categories could not be read from the plugin: The w-guardrails admin CLI answered something that is not its contract. Update the plugin.');
    expect(within(dialog).getByRole('button', { name: 'Add bypass' })).toBeDisabled();
  });

  it('Cancel sends nothing', async () => {
    const { calls } = stubFetch({ ...CSRF, [RULES]: { body: rules() } });
    render(<PermissionsPanel session={session} feed={feed(okCli())} />);
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Add a bypass' })).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });
});

describe('the Rules section', () => {
  it('is collapsed by default; opened it lists category, decision, source and bypassable', async () => {
    stubFetch({ ...CSRF, [RULES]: { body: rules() } });
    render(<PermissionsPanel session={session} feed={feed(okCli())} />);
    const toggle = await screen.findByRole('button', { name: /Rules/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('ssh-config')).toBeNull();
    fireEvent.click(toggle);
    const table = await screen.findByRole('table', { name: 'Guardrail rules of this folder' });
    const ssh = within(table).getByText('ssh-config').closest('tr') as HTMLElement;
    expect(ssh).toHaveTextContent('denied');
    expect(ssh).toHaveTextContent('hardcoded');
    expect(ssh).toHaveTextContent('no bypass');
    const push = within(table).getByText('git-push').closest('tr') as HTMLElement;
    expect(push).toHaveTextContent('asks');
    expect(push).toHaveTextContent('config');
    expect(push).toHaveTextContent('bypassable');
  });

  it('a config error is a visible notice even while the section is collapsed, with the file and the text', async () => {
    stubFetch({ ...CSRF, [RULES]: { body: rules({ configPresent: true, configError: 'Unexpected token } in JSON at position 41' }) } });
    render(<PermissionsPanel session={session} feed={feed(okCli())} />);
    const notice = await screen.findByText(/The guardrails configuration of this folder has an error/);
    expect(notice).toHaveTextContent('Unexpected token } in JSON at position 41');
    expect(notice).toHaveTextContent('/w/shop/.claude/guardrails.json');
  });

  it('rules that cannot be read are said inside the opened section, never an empty table', async () => {
    stubFetch({ ...CSRF, [RULES]: { body: rules({ ok: false, code: 'timeout', categories: [], errorText: 'The w-guardrails admin CLI did not answer within 10 s and was stopped.' }) } });
    render(<PermissionsPanel session={session} feed={feed(okCli())} />);
    fireEvent.click(await screen.findByRole('button', { name: /Rules/ }));
    expect(await screen.findByText(/The rules could not be read from the plugin: The w-guardrails admin CLI did not answer within 10 s/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the list of the session shows origin and uses left', () => {
  it('a bypass made from the page says so, another origin is named, an older one says nothing', () => {
    stubFetch({ ...CSRF, [RULES]: { body: rules() } });
    render(<PermissionsPanel session={session} feed={feed(okCli([cliGrant('a1b2c3d4', { origin: 'ui', usesLeft: 1 }), cliGrant('b2c3d4e5', { origin: 'dialog', usesLeft: null, mode: 'ttl' }), cliGrant('c3d4e5f6', { origin: null })]))} />);
    const first = document.querySelector('[data-cli-grant="a1b2c3d4"]') as HTMLElement;
    // The origin and the id are in the tooltip of the row (not in the row itself).
    expect(first).toHaveTextContent('Added from this page, with your PIN');
    expect(first.querySelector('[data-grant-uses]')).toHaveTextContent('1 use left');
    const second = document.querySelector('[data-cli-grant="b2c3d4e5"]') as HTMLElement;
    expect(second).toHaveTextContent('dialog');
    // No use limit: nothing is said about uses.
    expect(second.querySelector('[data-grant-uses]')).toBeNull();
    expect(second).not.toHaveTextContent('no use limit');
    const third = document.querySelector('[data-cli-grant="c3d4e5f6"]') as HTMLElement;
    expect(third).not.toHaveTextContent('Origin');
  });
});
