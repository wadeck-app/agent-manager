import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAUNCH_STORAGE_KEY } from '../logic/launchForm.js';
import { ownedDto } from '../logic/fixtures.js';
import { stubFetch } from '../owned/testFetch.js';
import type { ApiError } from '../shared.js';
import { DAEMON_START_COMMAND } from './DaemonNotRunning.js';
import { NewSessionDialog } from './NewSessionDialog.js';

// The folder picker reads the folder routes as soon as the dialog opens: an empty machine unless a test routes its own.
beforeEach(() => {
  window.localStorage.clear();
  stubFetch({});
});
afterEach(() => vi.unstubAllGlobals());

const NOT_RUNNING: ApiError = { code: 'daemon-not-running', message: 'The agent-manager daemon is not running', hint: 'Start it with: agent-manager start --detach' };

function open(props: Partial<Parameters<typeof NewSessionDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onLaunched = vi.fn();
  const view = render(<NewSessionDialog ownedError={null} ownedErrorText="" onClose={onClose} onLaunched={onLaunched} {...props} />);
  return { onClose, onLaunched, ...view };
}

const launchButton = (): HTMLElement => screen.getByRole('button', { name: 'Launch' });
const folder = (): HTMLInputElement => screen.getByLabelText('Folder');

describe('New session dialog: the form', () => {
  it('keeps Launch disabled until the folder is a valid absolute path, and says why a path is refused', async () => {
    open();
    expect(launchButton()).toBeDisabled();
    await userEvent.type(folder(), 'shop');
    expect(screen.getByRole('alert')).toHaveTextContent(/absolute path/);
    expect(launchButton()).toBeDisabled();
    await userEvent.clear(folder());
    // violations-suppress: shared/no-out-of-repo-path a Windows path as the user types it, never read from disk
    await userEvent.type(folder(), 'C:\\Projects\\shop');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(launchButton()).toBeEnabled();
  });

  it('holds a Terminal session name to the hc terminal shape', async () => {
    open();
    await userEvent.type(folder(), '/work/shop');
    await userEvent.type(screen.getByLabelText('Name (optional)'), 'Billing fix');
    expect(launchButton()).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: /Terminal session/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(/1 to 32 characters/);
    expect(launchButton()).toBeDisabled();
  });

  it('offers the recent folders of the server (the default picker), one click fills the folder and shows its branch', async () => {
    stubFetch({
      'GET /folders/recent': {
        body: {
          ok: true,
          warnings: [],
          folders: [
            { name: 'new', path: '/work/new', hasGit: true, isRecent: true, isKnownProject: true, isLink: false, branch: 'main', lastUsedAt: 99, uses: 2, exists: true },
            { name: 'old', path: '/work/old', hasGit: false, isRecent: true, isKnownProject: true, isLink: false, lastUsedAt: 1, uses: 1, exists: true },
          ],
        },
      },
    });
    open();
    const buttons = await screen.findAllByRole('button', { name: /^(new|old)/ });
    expect(buttons.map((button) => button.getAttribute('title'))).toEqual(['/work/new', '/work/old']);
    await userEvent.click(buttons[0]!);
    expect(folder().value).toBe('/work/new');
    expect(document.querySelector('[data-picked-folder]')).toHaveTextContent('new');
    expect(document.querySelector('[data-picked-folder]')).toHaveTextContent('main');
    // Typing another path forgets what was known of the picked folder.
    await userEvent.type(folder(), 'x');
    expect(document.querySelector('[data-picked-folder]')).toBeNull();
  });

  it('describes both hosts honestly and remembers the host, model and mode (not the folder)', async () => {
    const first = open();
    expect(screen.getByText(/structured log, permission requests answered in this page, no terminal/)).toBeInTheDocument();
    expect(screen.getByText(/permission requests are answered in that terminal, not here/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Terminal session/ }));
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'haiku');
    await userEvent.selectOptions(screen.getByLabelText('Permission mode'), 'plan');
    await userEvent.type(folder(), '/work/shop');
    expect(JSON.parse(window.localStorage.getItem(LAUNCH_STORAGE_KEY) ?? '{}')).toEqual({ hostKind: 'hc', model: 'haiku', permissionMode: 'plan' });
    first.unmount();
    open();
    expect(screen.getByRole('radio', { name: /Terminal session/ })).toBeChecked();
    expect(screen.getByLabelText('Model')).toHaveValue('haiku');
    expect(screen.getByLabelText('Permission mode')).toHaveValue('plan');
    expect(folder().value).toBe('');
  });
});

describe('New session dialog: the daemon', () => {
  it('daemon not running: shows the fix command with a copy button and keeps Launch disabled', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open({ ownedError: NOT_RUNNING, ownedErrorText: `${NOT_RUNNING.message}. ${NOT_RUNNING.hint}` });
    expect(document.querySelector('[data-daemon-command]')).toHaveTextContent(DAEMON_START_COMMAND);
    expect(DAEMON_START_COMMAND).toBe('agent-manager start --detach');
    await userEvent.type(folder(), '/work/shop');
    expect(launchButton()).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Copy the command' }));
    expect(writeText).toHaveBeenCalledWith('agent-manager start --detach');
  });

  it('any other daemon problem is shown as the server wrote it, with its hint, and the launch is left to answer', async () => {
    open({ ownedError: { code: 'daemon-unauthorized', message: 'The daemon refused the token', hint: 'Restart it: agent-manager stop, then agent-manager start --detach' }, ownedErrorText: 'The daemon refused the token. Restart it: agent-manager stop, then agent-manager start --detach' });
    expect(screen.getByRole('alert')).toHaveTextContent('The daemon refused the token. Restart it: agent-manager stop, then agent-manager start --detach');
    expect(document.querySelector('[data-daemon-command]')).toBeNull();
    await userEvent.type(folder(), '/work/shop');
    expect(launchButton()).toBeEnabled();
  });
});

describe('New session dialog: launching', () => {
  it('posts only the chosen fields through the CSRF client, then hands the session over and closes', async () => {
    const dto = ownedDto({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cwd: '/work/shop' });
    const { calls } = stubFetch({ 'POST /owned/launch': { body: { ok: true, session: dto } } });
    const { onLaunched, onClose } = open();
    await userEvent.type(folder(), '/work/shop');
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'haiku');
    await userEvent.click(launchButton());
    await waitFor(() => expect(onLaunched).toHaveBeenCalledWith(dto));
    expect(onClose).toHaveBeenCalled();
    // The picker's own reads (GET /folders/...) are not launches: exactly one write.
    const writes = calls.filter((call) => call.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ path: '/owned/launch', body: { hostKind: 'stream-json', cwd: '/work/shop', model: 'haiku' } });
    expect(writes[0]?.headers['X-Agent-Manager-Csrf']).toBe('test-token');
  });

  it('a refused launch stays in the dialog with what the daemon said and its hint, and Launch is available again', async () => {
    stubFetch({ 'POST /owned/launch': { status: 400, body: { ok: false, error: { code: 'cwd-missing', message: 'the working directory C:\\nope cannot be used', hint: 'create the folder or pass the path of an existing project folder' } } } });
    const { onLaunched, onClose } = open();
    // violations-suppress: shared/no-out-of-repo-path a Windows path as the user types it, never read from disk
    await userEvent.type(folder(), 'C:\\nope');
    await userEvent.click(launchButton());
    expect(await screen.findByText(/cannot be used\. create the folder or pass the path/)).toBeInTheDocument();
    expect(onLaunched).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(launchButton()).toBeEnabled();
  });

  it('Escape closes the dialog', () => {
    const { onClose } = open();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('New session dialog: the Background session choice', () => {
  it('offers it as the third way to run, says the folder must be trusted, and launches with hostKind bg', async () => {
    const { calls } = stubFetch({ 'POST /owned/launch': { body: { ok: true, session: ownedDto({ hostKind: 'bg', jobId: 'abcd1234' }) } } });
    const { onLaunched } = open();
    expect(screen.queryByText(/must already be trusted by Claude Code/)).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: /Background session/ }));
    expect(screen.getByText(/Survives the daemon, you can attach in a terminal/)).toBeInTheDocument();
    expect(screen.getByText(/must already be trusted by Claude Code/)).toBeInTheDocument();
    await userEvent.type(folder(), '/work/shop');
    await userEvent.type(screen.getByLabelText('Name (optional)'), '-bad');
    expect(screen.getByRole('alert')).toHaveTextContent(/must not start with/);
    expect(launchButton()).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Name (optional)'));
    await userEvent.click(launchButton());
    await waitFor(() => expect(onLaunched).toHaveBeenCalled());
    expect(calls.find((call) => call.path === '/owned/launch')?.body).toMatchObject({ hostKind: 'bg', cwd: '/work/shop' });
    expect(JSON.parse(window.localStorage.getItem(LAUNCH_STORAGE_KEY) ?? '{}')).toMatchObject({ hostKind: 'bg' });
  });

  it('shows the refusal of an untrusted folder with its fix', async () => {
    stubFetch({ 'POST /owned/launch': { status: 422, body: { ok: false, error: { code: 'workspace-not-trusted', message: 'Claude Code does not trust the folder /work/shop', hint: 'run claude once in /work/shop, accept the trust dialog, quit, then retry' } } } });
    open();
    await userEvent.click(screen.getByRole('radio', { name: /Background session/ }));
    await userEvent.type(folder(), '/work/shop');
    await userEvent.click(launchButton());
    expect(await screen.findByText(/does not trust the folder .*accept the trust dialog/)).toBeInTheDocument();
  });
});
