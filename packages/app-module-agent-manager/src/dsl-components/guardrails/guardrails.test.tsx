import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockedText, bypassCommand, recentBlockedText, recentChipLabel, recentChipRows, recentChipTooltip, clockText, COMMAND_PREVIEW, previewOf, remainingText, subagentOf } from '../logic/guardrails.js';
import { row } from '../logic/fixtures.js';
import { folderName } from '../logic/folderPicker.js';
import { RowMarks } from '../lists/RowMarks.js';
import type { DenialDto, DenialsDto, GuardrailsOverviewDto } from '../shared.js';
import { GuardrailsPage } from '../components/GuardrailsPage.js';
import { PageTitle } from '../components/PageTitle.js';

const json = (body: unknown, ok = true, status = 200): Response => ({ ok, status, json: async () => body }) as unknown as Response;

const OVERVIEW: GuardrailsOverviewDto = {
  ok: true,
  generatedAt: '2026-11-21T10:00:00.000Z',
  killSwitch: { active: false, path: '/home/.claude/w-guardrails/DISABLED', errorText: '' },
  projects: [{ path: '/work/shop', sources: ['registry'], hasFiles: true }],
  sourcesText: ['Claude Code session registry (/reg): 1 folder(s) from 1 session(s), alive or ended.'],
  grants: [{ id: 'g1', category: 'rm', mode: 'once', expiresAt: Date.now() + 29 * 60_000, remainingMs: 29 * 60_000, sessionId: '287760ca-77b9-418b-bd68-c242d65b4d67', sessionName: 'shop agent', project: '/work/shop', rationale: 'clean the build folder', used: 0, maxUses: 1 }],
  sessions: [{ sessionId: '287760ca-77b9-418b-bd68-c242d65b4d67', prefix: '287760ca', sessionName: 'shop agent', project: '/work/shop', blocks: [{ category: 'interpreter-exec', count: 37 }, { category: 'rm', count: 30 }], total: 67, refusedCount: 3, timeoutUntil: Date.now() + 20 * 60_000, lastRequestAt: null }],
  configs: [{ project: '/work/shop', file: '/work/shop/.claude/guardrails.json', state: 'ok', categories: [{ name: 'rm', decision: 'deny' }], categoryMessages: 0, protectedFiles: [], hasSecrets: false, warnings: ["Unknown key 'extra': this reader does not know it."], errorText: '' }],
  problems: [],
  hiddenEntries: 0,
  rulesNote: 'Rules view needs plugin API A2: defaults are not shown.',
  formatVersion: 1,
};

const DENIAL: DenialDto = { at: Date.parse('2026-11-21T10:00:00.000Z'), day: '2026-11-21', session: '287760ca:M', prefix: '287760ca', sessionName: 'shop agent', decision: 'deny', category: 'rm', project: '/work/shop', tool: 'Bash', file: '', hasCommand: true };

function denials(over: Partial<DenialsDto> = {}, withCommand?: string): DenialsDto {
  return {
    ok: true,
    generatedAt: '2026-11-21T10:00:00.000Z',
    denials: [withCommand === undefined ? DENIAL : { ...DENIAL, command: withCommand }],
    days: ['2026-11-21', '2026-11-20'],
    categories: ['kill', 'rm'],
    filter: { day: '', category: '', session: '', limit: 100 },
    truncated: false,
    bytesRead: 2048,
    skipped: { count: 0, example: '' },
    withCommands: withCommand !== undefined,
    note: 'The texts of the journal are not masked: a command may hold a token.',
    problems: [],
    ...over,
  };
}

interface Stub {
  plain?: (url: string) => Response;
  commands?: (url: string) => Response | Promise<Response>;
}

function stub(options: Stub = {}): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string) => {
    if (url.includes('/guardrails/denials/commands')) {
      return (options.commands ?? (() => json(denials({}, 'rm -rf build'))))(url);
    }
    if (url.includes('/guardrails/denials')) {
      return (options.plain ?? (() => json(denials())))(url);
    }
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('text helpers', () => {
  it('remainingText', () => {
    expect(remainingText(0)).toBe('expired');
    expect(remainingText(42_000)).toBe('42 s');
    expect(remainingText(29 * 60_000)).toBe('29 min');
    expect(remainingText(65 * 60_000)).toBe('1 h 05 min');
  });
  it('bypassCommand, blockedText, folderName, subagentOf, clockText', () => {
    expect(bypassCommand('rm')).toBe('/w-guardrails:request-bypass rm once');
    expect(bypassCommand('rm', '5m')).toBe('/w-guardrails:request-bypass rm 5m');
    expect(blockedText({ total: 37, categories: [{ category: 'interpreter-exec', count: 37 }], timeout: false, recent: { total: 2, categories: [{ category: 'interpreter-exec', count: 2 }] } })).toBe('Blocked 37 times in total on interpreter-exec, 2 in the last 30 min');
    expect(blockedText({ total: 1, categories: [{ category: 'rm', count: 1 }], timeout: false, recent: { total: 0, categories: [] } })).toBe('Blocked 1 time in total on rm, none in the last 30 min');
    expect(blockedText({ total: 10, categories: ['a', 'b', 'c', 'd'].map((category) => ({ category, count: 1 })), timeout: false, recent: { total: 1, categories: [{ category: 'a', count: 1 }] } })).toBe('Blocked 10 times in total (a 1, b 1, c 1, 1 more), 1 in the last 30 min');
    expect(blockedText({ total: 0, categories: [], timeout: true, recent: { total: 2, categories: [{ category: 'rm', count: 2 }] } })).toBe('Blocked 2 times in the last 30 min on rm');
    expect(recentBlockedText({ total: 37, categories: [], timeout: false, recent: { total: 2, categories: [{ category: 'rm', count: 1 }, { category: 'kill', count: 1 }] } })).toBe('Blocked 2 times in the last 30 min (rm 1, kill 1)');
    expect(recentBlockedText({ total: 37, categories: [], timeout: false, recent: { total: 0, categories: [] } })).toBe('');
    expect(folderName('/work/shop/')).toBe('shop');
    expect(subagentOf('287760ca:M')).toBe('');
    expect(subagentOf('287760ca:A:a2a5:general-purpose')).toBe('general-purpose');
    expect(clockText(Date.parse('2026-11-21T10:00:00.000Z'))).toMatch(/^2026-11-2[01] \d\d:\d\d:\d\d$/);
  });
  it('recentChipLabel and recentChipTooltip: only the last 30 min, every category, empty when none', () => {
    const none = { total: 37, categories: [], timeout: false, recent: { total: 0, categories: [] } };
    expect(recentChipLabel(undefined)).toBe('');
    expect(recentChipLabel(none)).toBe('');
    const some = { total: 37, categories: [], timeout: false, recent: { total: 5, categories: ['rm', 'kill', 'eval', 'python'].map((category, index) => ({ category, count: index === 0 ? 2 : 1 })) } };
    expect(recentChipLabel(some)).toBe('5 blocked');
    expect(recentChipTooltip(some)).toBe('Blocked 5 times in the last 30 min. Click to open the Permissions tab');
    expect(recentChipRows(some)).toEqual([
      { label: 'rm', value: '2' },
      { label: 'kill', value: '1' },
      { label: 'eval', value: '1' },
      { label: 'python', value: '1' },
    ]);
    expect(recentChipTooltip({ ...some, timeout: true, recent: { total: 1, categories: [{ category: 'rm', count: 1 }] } })).toBe('Blocked 1 time in the last 30 min. Bypass requests are timed out. Click to open the Permissions tab');
  });
  it('previewOf cuts a long command and keeps a short one', () => {
    expect(previewOf('ls', false)).toEqual({ text: 'ls', cut: false });
    const long = 'x'.repeat(COMMAND_PREVIEW + 50);
    expect(previewOf(long, false)).toEqual({ text: `${'x'.repeat(COMMAND_PREVIEW)}...`, cut: true });
    expect(previewOf(long, true)).toEqual({ text: long, cut: false });
  });
});

describe('GuardrailsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders inside the scope wrapper and shows the grants, the blocked sessions, the rules and what was scanned', async () => {
    stub();
    const { container } = render(<GuardrailsPage overview={OVERVIEW} />);
    expect(container.firstElementChild).toHaveClass('agents-scope');
    const grants = await screen.findByRole('table', { name: 'Active bypasses' });
    expect(within(grants).getByText('rm')).toBeInTheDocument();
    expect(within(grants).getByText('Once')).toBeInTheDocument();
    expect(within(grants).getByText('29 min')).toBeInTheDocument();
    expect(within(grants).getByText('clean the build folder')).toBeInTheDocument();
    expect(within(grants).getByRole('link', { name: 'shop agent' })).toHaveAttribute('href', '/modules/agent-manager/agents?session=287760ca-77b9-418b-bd68-c242d65b4d67');
    expect(within(grants).getByText('0 of 1')).toBeInTheDocument();
    const blocked = screen.getByRole('table', { name: 'Blocked sessions' });
    expect(within(blocked).getByText('37')).toBeInTheDocument();
    // The page keeps the full history and says so in the column title.
    expect(within(blocked).getByRole('columnheader', { name: 'Blocked in total' })).toBeInTheDocument();
    expect(within(blocked).getByText('on interpreter-exec')).toBeInTheDocument();
    expect(within(blocked).getByText(/Timed out for .* after 3 refused requests/)).toBeInTheDocument();
    expect(screen.getByText(/Rules view needs plugin API A2/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Category decisions' })).toHaveTextContent('rm: deny');
    expect(screen.getByText(/Unknown key 'extra'/)).toBeInTheDocument();
    expect(screen.getByText(/1 folder\(s\) from 1 session\(s\)/)).toBeInTheDocument();
  });

  it('keeps the base page spacing (1rem) above its first card: the page header line above must not touch it', () => {
    const { container } = render(<GuardrailsPage overview={OVERVIEW} />);
    expect(container.firstElementChild?.firstElementChild).toHaveClass('pt-4');
  });

  it('copies the bypass command of a category (the module grants nothing)', async () => {
    stub();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<GuardrailsPage overview={OVERVIEW} />);
    const blocked = await screen.findByRole('table', { name: 'Blocked sessions' });
    fireEvent.click(within(blocked).getByRole('button', { name: /Copy \/w-guardrails:request-bypass interpreter-exec once/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/w-guardrails:request-bypass interpreter-exec once'));
  });

  it('shows the kill switch as an alert with the file to delete', async () => {
    stub();
    render(<GuardrailsPage overview={{ ...OVERVIEW, killSwitch: { active: true, path: '/home/.claude/w-guardrails/DISABLED', errorText: '' } }} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('kill switch is ON');
    expect(alert).toHaveTextContent('DISABLED');
  });

  it('names every problem file with the hint, and a malformed rules file as an error', async () => {
    stub();
    const broken = {
      ...OVERVIEW,
      problems: [{ file: '/work/shop/.claude/w-guardrails/state.json', message: 'has an unknown shape', hint: 'Update this module.' }],
      configs: [{ ...OVERVIEW.configs[0]!, state: 'malformed' as const, categories: [], warnings: [], errorText: 'is not valid JSON: Unexpected end. Fix it by hand.' }],
    };
    render(
      <>
        <PageTitle title="Guardrails" guardrails={broken} />
        <GuardrailsPage overview={broken} />
      </>,
    );
    // The problem file is a notice behind the button of the title line, never an inline stack on the page.
    expect(screen.queryByText('state.json: has an unknown shape')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: '1 notice' }));
    expect(screen.getByText('state.json: has an unknown shape')).toBeInTheDocument();
    expect(screen.getByText('/work/shop/.claude/w-guardrails/state.json has an unknown shape. Update this module.')).toBeInTheDocument();
    expect(screen.getByText(/The plugin IGNORES this file/)).toBeInTheDocument();
    expect(screen.getByText(/is not valid JSON: Unexpected end/)).toBeInTheDocument();
  });

  it('says why a section is empty', async () => {
    stub();
    render(<GuardrailsPage overview={{ ...OVERVIEW, grants: [], sessions: [], configs: [], hiddenEntries: 2 }} />);
    expect(await screen.findByText('No active bypass')).toBeInTheDocument();
    expect(screen.getByText(/2 entries are left out because the hook ignores them/)).toBeInTheDocument();
    expect(screen.getByText('No session has been blocked')).toBeInTheDocument();
    expect(screen.getByText('No project has a rules file')).toBeInTheDocument();
  });

  it('says it is loading while the source has not answered, and does not claim to load when it answered an error (the page shows that error)', async () => {
    stub();
    const { rerender } = render(<GuardrailsPage />);
    expect(screen.getByText('Reading the plugin files...')).toBeInTheDocument();
    rerender(<GuardrailsPage overview={{ ok: false, errorText: 'The session registry cannot be read' } as unknown as GuardrailsOverviewDto} />);
    expect(screen.queryByText('Reading the plugin files...')).toBeNull();
    // The denial timeline does not depend on the overview.
    expect(await screen.findByRole('table', { name: 'Recent denials' })).toBeInTheDocument();
  });

  it('lists the denials without commands, and says the commands are hidden', async () => {
    const mock = stub();
    render(<GuardrailsPage overview={OVERVIEW} />);
    const table = await screen.findByRole('table', { name: 'Recent denials' });
    expect(within(table).getByText('Denied')).toBeInTheDocument();
    expect(within(table).getByText('287760ca')).toBeInTheDocument();
    expect(within(table).getByText(/Command hidden: turn on Show commands/)).toBeInTheDocument();
    expect(mock.mock.calls.some(([url]) => String(url).includes('/denials/commands'))).toBe(false);
    expect(screen.getByText(/Read 2 KB from the end of the journal/)).toBeInTheDocument();
  });

  it('asks the PIN route when Show commands is on, truncates a long command and expands it on request', async () => {
    const long = `curl -H "Authorization: ${'x'.repeat(200)}" https://example.test`;
    const mock = stub({ commands: () => json(denials({}, long)) });
    render(<GuardrailsPage overview={OVERVIEW} />);
    await screen.findByRole('table', { name: 'Recent denials' });
    fireEvent.click(screen.getByRole('button', { name: /Show commands \(PIN\)/ }));
    const table = await screen.findByRole('table', { name: 'Recent denials' });
    await waitFor(() => expect(mock.mock.calls.some(([url]) => String(url).includes('/guardrails/denials/commands?'))).toBe(true));
    await within(table).findByText(/^curl -H "Authorization: x+\.\.\.$/);
    expect(screen.getByText(/not masked/)).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Show full' }));
    expect(within(table).getByText(long)).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });

  it('falls back to the list without commands when the PIN route fails, and says why', async () => {
    stub({ commands: () => json({ error: { message: 'Sensitive action cancelled: PIN not entered', hint: 'Enter the PIN.' } }, false, 401) });
    render(<GuardrailsPage overview={OVERVIEW} />);
    await screen.findByRole('table', { name: 'Recent denials' });
    fireEvent.click(screen.getByRole('button', { name: /Show commands \(PIN\)/ }));
    expect(await screen.findByText(/The command texts are not shown: .*Sensitive action cancelled/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Recent denials' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show commands \(PIN\)/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('a filter change while the PIN dialog is open: the old answer is never shown and the PIN route is not called twice at once', async () => {
    const releases: (() => void)[] = [];
    const seen: string[] = [];
    stub({
      commands: (url) => {
        seen.push(url);
        const text = url.includes('category=kill') ? 'second-command' : 'first-command';
        return new Promise<Response>((resolve) => releases.push(() => resolve(json(denials({}, text)))));
      },
    });
    render(<GuardrailsPage overview={OVERVIEW} />);
    await screen.findByRole('table', { name: 'Recent denials' });
    fireEvent.click(screen.getByRole('button', { name: /Show commands \(PIN\)/ }));
    await waitFor(() => expect(seen).toHaveLength(1));
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'kill' } });
    // The second request waits for the first dialog: still one call.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen).toHaveLength(1);
    releases[0]!();
    await waitFor(() => expect(seen).toHaveLength(2));
    releases[1]!();
    expect(await screen.findByText('second-command')).toBeInTheDocument();
    expect(screen.queryByText('first-command')).toBeNull();
  });

  it('sends the filters to the route', async () => {
    const mock = stub();
    render(<GuardrailsPage overview={OVERVIEW} />);
    await screen.findByRole('table', { name: 'Recent denials' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'rm' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Day' }), { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Session prefix' }), { target: { value: 'AB12' } });
    await waitFor(() => {
      const urls = mock.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes('/guardrails/denials?') && url.includes('day=2026-11-20') && url.includes('category=rm') && url.includes('session=ab12'))).toBe(true);
    });
    // Not a hexadecimal character: refused in the field, never sent.
    fireEvent.change(screen.getByRole('textbox', { name: 'Session prefix' }), { target: { value: 'zz' } });
    expect(screen.getByRole('textbox', { name: 'Session prefix' })).toHaveValue('ab12');
  });

  it('reports the journal problems and the unread rest', async () => {
    stub({ plain: () => json(denials({ truncated: true, problems: [{ file: '/j', message: '3 line(s) of the journal do not have the known shape', hint: 'Update the module.' }] })) });
    render(<GuardrailsPage overview={OVERVIEW} />);
    expect(await screen.findByText(/3 line\(s\) of the journal do not have the known shape/)).toBeInTheDocument();
    expect(screen.getByText(/Older records exist that were not read/)).toBeInTheDocument();
  });

  it('uses no UPPERCASE text and no glyph arrows', async () => {
    stub();
    const { container } = render(<GuardrailsPage overview={OVERVIEW} />);
    await screen.findByRole('table', { name: 'Active bypasses' });
    expect(container.innerHTML).not.toMatch(/\buppercase\b/);
    expect(container.textContent).not.toMatch(/[\u2190-\u21ff\u2022\u2713\u2715]/);
  });
});

describe('the chip of a session row', () => {
  it('shows the RECENT count and says the window for a session blocked in the last 30 min, nothing for another', () => {
    const blocked = row({ guardrailBlocks: { total: 37, categories: [{ category: 'interpreter-exec', count: 37 }], timeout: false, recent: { total: 2, categories: [{ category: 'interpreter-exec', count: 2 }] } } });
    const { container, rerender } = render(<RowMarks session={blocked} />);
    expect(screen.getByLabelText('Blocked 2 times in the last 30 min on interpreter-exec')).toHaveTextContent('2');
    expect(container.textContent).not.toContain('37');
    rerender(<RowMarks session={row()} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('shows no badge at all when nothing was blocked in the last 30 min, however many times it was blocked before', () => {
    const old = row({ guardrailBlocks: { total: 37, categories: [{ category: 'rm', count: 37 }], timeout: false, recent: { total: 0, categories: [] } } });
    const { container } = render(<RowMarks session={old} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByLabelText(/Blocked/)).toBeNull();
  });

  it('a bypass timeout is said in the tooltip text of a recent badge', () => {
    const blocked = row({ guardrailBlocks: { total: 3, categories: [{ category: 'rm', count: 3 }], timeout: true, recent: { total: 1, categories: [{ category: 'rm', count: 1 }] } } });
    render(<RowMarks session={blocked} />);
    expect(screen.getByLabelText('Blocked 1 time in the last 30 min on rm. Bypass requests are timed out')).toHaveTextContent('1');
  });
});
