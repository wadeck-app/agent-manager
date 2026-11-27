import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAVORITES_STORAGE_KEY, type FolderPick } from '../logic/folderPicker.js';
import { DEFAULT_FOLDER_PICKER, FOLDER_PICKER_VARIANTS, type FolderPickerVariant } from '../logic/folderVariants.js';
import { stubFetch, type Call, type FakeAnswer } from '../owned/testFetch.js';
import type { FolderEntryDto } from '../shared.js';
import { FolderPicker } from './FolderPicker.js';

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function entry(parent: string, name: string, extra: Partial<FolderEntryDto> = {}): FolderEntryDto {
  return { name, path: `${parent}/${name}`, hasGit: false, isRecent: false, isKnownProject: false, isLink: false, ...extra };
}

type Listing = FolderEntryDto[] | { entries: FolderEntryDto[]; truncated?: boolean; skipped?: number } | { status: number; code: string; message: string };

/** The answer of GET /folders/list for the folders of `tree` (a path outside it is a 403 like the real one). */
function listRoutes(tree: Record<string, Listing>): Record<string, (call: Call) => FakeAnswer | Promise<FakeAnswer>> {
  return {
    'GET /folders/list': (call) => {
      const path = new URLSearchParams(call.query).get('path') ?? '';
      const found = tree[path];
      if (found === undefined) {
        return { status: 403, body: { ok: false, error: { code: 'folder-not-browsable', message: `${path} is outside the folders that can be browsed`, hint: "run 'agent-manager launch-roots add' for it" } } };
      }
      if ('status' in found) {
        return { status: found.status, body: { ok: false, error: { code: found.code, message: found.message, hint: 'Fix it and retry' } } };
      }
      const entries = Array.isArray(found) ? found : found.entries;
      const parts = path.split('/').filter(Boolean);
      const root = `/${parts[0] ?? ''}`;
      const crumbs = parts.map((name, index) => ({ name: index === 0 ? root : name, path: `/${parts.slice(0, index + 1).join('/')}` }));
      return {
        body: {
          ok: true,
          path,
          name: parts[parts.length - 1] ?? path,
          parent: parts.length <= 1 ? null : `/${parts.slice(0, -1).join('/')}`,
          breadcrumbs: crumbs,
          entries,
          truncated: Array.isArray(found) ? false : (found.truncated ?? false),
          limit: 300,
          skipped: Array.isArray(found) ? 0 : (found.skipped ?? 0),
          hasGit: false,
        },
      };
    },
  };
}

const ROOT = { path: '/work', name: 'work', source: 'config' as const };
const rootsRoute = (roots: { path: string; name: string; source: string }[] = [ROOT], note = ''): Record<string, FakeAnswer> => ({ 'GET /folders/roots': { body: { ok: true, roots, configFile: '/cfg/config.yml', note } } });

const TREE: Record<string, Listing> = {
  '/work': [entry('/work', 'alpha', { hasGit: true, branch: 'main' }), entry('/work', 'beta'), entry('/work', 'gamma')],
  '/work/alpha': [entry('/work/alpha', 'src'), entry('/work/alpha', 'docs')],
  '/work/beta': [],
  '/work/gamma': { status: 403, code: 'folder-unreadable', message: '/work/gamma cannot be read by the app-core process (EACCES)' },
};

interface HostProps {
  variant: FolderPickerVariant;
  initial?: string;
  onPick?: (pick: FolderPick) => void;
  onSubmit?: () => void;
}

/** The dialog's role for the picker: it owns the text of the field and what is picked, inside a form (Enter must not submit from a helper). */
function Host({ variant, initial = '', onPick, onSubmit }: HostProps) {
  const [value, setValue] = useState(initial);
  const [picked, setPicked] = useState<FolderPick | undefined>(undefined);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <label htmlFor="cwd">Folder</label>
      <FolderPicker
        inputId="cwd"
        value={value}
        onChange={setValue}
        onPick={(pick) => {
          setPicked(pick);
          setValue(pick.path);
          onPick?.(pick);
        }}
        onKnow={setPicked}
        picked={picked}
        disabled={false}
        invalid={false}
        placeholder="/projects/shop"
        variant={variant}
      />
      <button type="submit">Launch</button>
    </form>
  );
}

const field = (): HTMLInputElement => screen.getByLabelText('Folder');

describe('the A/B test of the picker', () => {
  it('shows the smart list when nothing was chosen, and every variant is described for the dock', async () => {
    stubFetch({ ...rootsRoute() });
    render(
      <FolderPicker inputId="cwd" value="" onChange={() => undefined} onPick={() => undefined} onKnow={() => undefined} picked={undefined} disabled={false} invalid={false} placeholder="" />,
    );
    expect(document.querySelector('[data-folder-picker]')).toHaveAttribute('data-folder-picker', DEFAULT_FOLDER_PICKER);
    expect(DEFAULT_FOLDER_PICKER).toBe('smart');
    expect(FOLDER_PICKER_VARIANTS.map((variant) => variant.id)).toEqual(['tree', 'columns', 'smart', 'explorer', 'palette']);
    expect(FOLDER_PICKER_VARIANTS.every((variant) => variant.hint.length > 40 && variant.label.startsWith('V'))).toBe(true);
    expect(FOLDER_PICKER_VARIANTS.find((variant) => variant.id === DEFAULT_FOLDER_PICKER)?.hint).toContain('Default');
  });
});

describe('V1 tree', () => {
  it('opens the only root, lists its folders with the branch, picks on click and opens the folder', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes(TREE) });
    const onPick = vi.fn();
    render(<Host variant="tree" onPick={onPick} />);
    const alpha = await screen.findByRole('treeitem', { name: /alpha/ });
    expect(alpha).toHaveTextContent('main');
    expect(screen.getAllByRole('treeitem').map((item) => item.getAttribute('data-folder-path'))).toEqual(['/work', '/work/alpha', '/work/beta', '/work/gamma']);
    await userEvent.click(alpha);
    expect(onPick).toHaveBeenCalledWith({ path: '/work/alpha', name: 'alpha', hasGit: true, branch: 'main' });
    expect(field().value).toBe('/work/alpha');
    expect(await screen.findByRole('treeitem', { name: /src/ })).toHaveAttribute('aria-level', '3');
    expect(document.querySelector('[data-picked-folder]')).toHaveTextContent('alpha');
    expect(document.querySelector('[data-picked-folder]')).toHaveTextContent('main');
  });

  it('is driven by the keyboard: arrows walk, Right opens, Left closes then goes to the parent, Enter picks', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes(TREE) });
    const onPick = vi.fn();
    render(<Host variant="tree" onPick={onPick} />);
    const root = await screen.findByRole('treeitem', { name: /work/ });
    root.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: /alpha/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByRole('treeitem', { name: /src/ })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: /src/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: /alpha/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('treeitem', { name: /src/ })).toBeNull();
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ path: '/work/alpha' }));
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('treeitem', { name: /gamma/ })).toHaveFocus();
  });

  it('filters the open folders by name, and says when nothing matches; Enter in the filter does not submit', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes(TREE) });
    const onSubmit = vi.fn();
    render(<Host variant="tree" onSubmit={onSubmit} />);
    await screen.findByRole('treeitem', { name: /alpha/ });
    const filter = screen.getByLabelText('Filter the folders');
    await userEvent.type(filter, 'bet{Enter}');
    expect(screen.getAllByRole('treeitem').map((item) => item.getAttribute('data-folder-path'))).toEqual(['/work', '/work/beta']);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says a folder is being read, and a failure with its text and a Retry that asks again', async () => {
    let attempts = 0;
    stubFetch({
      ...rootsRoute(),
      'GET /folders/list': () => {
        attempts += 1;
        return attempts === 1
          ? { status: 403, body: { ok: false, error: { code: 'folder-unreadable', message: '/work cannot be read by the app-core process (EACCES)', hint: 'pick another folder, or fix the permissions' } } }
          : { body: { ok: true, path: '/work', name: 'work', parent: null, breadcrumbs: [], entries: [entry('/work', 'alpha')], truncated: false, limit: 300, skipped: 0, hasGit: false } };
      },
    });
    render(<Host variant="tree" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('/work cannot be read by the app-core process (EACCES). pick another folder, or fix the permissions');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('treeitem', { name: /alpha/ })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('reads the roots (loading), then says nothing can be browsed yet with the command to run when there is no root', async () => {
    stubFetch({ ...rootsRoute([], 'No folder can be browsed yet: run agent-manager launch-roots add <path>.') });
    render(<Host variant="tree" />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading the folders you can browse');
    expect(await screen.findByText(/Nothing to browse yet\. Type the path in the Folder field, or add a folder with: agent-manager launch-roots add <path>/)).toBeInTheDocument();
    expect(screen.getByText(/No folder can be browsed yet/)).toBeInTheDocument();
  });

  it('flags a folder listing that was cut at the limit, an empty folder, and a folder that failed', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes({ ...TREE, '/work': { entries: [entry('/work', 'alpha'), entry('/work', 'beta'), entry('/work', 'gamma')], truncated: true } }) });
    render(<Host variant="tree" />);
    expect(await screen.findByText(/Only the first 300 folders are listed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('treeitem', { name: /beta/ }));
    expect(await screen.findByText('No subfolder.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('treeitem', { name: /gamma/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('/work/gamma cannot be read');
  });
});

describe('V2 columns', () => {
  it('opens a column per selected folder, left to right, and picks the selected folder', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes(TREE) });
    const onPick = vi.fn();
    render(<Host variant="columns" onPick={onPick} />);
    await userEvent.click(await screen.findByRole('option', { name: /alpha/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ path: '/work/alpha', branch: 'main' }));
    const inner = await screen.findByRole('listbox', { name: 'Folders in /work/alpha' });
    expect(within(inner).getAllByRole('option').map((option) => option.textContent)).toEqual(['src', 'docs']);
    expect(screen.getAllByRole('listbox')).toHaveLength(3);
    expect(field().value).toBe('/work/alpha');
  });

  it('is driven by the keyboard: arrows walk a column without reading, Right opens and enters the next column, Left goes back', async () => {
    const { calls } = stubFetch({ ...rootsRoute(), ...listRoutes(TREE) });
    render(<Host variant="columns" />);
    const alpha = await screen.findByRole('option', { name: /alpha/ });
    alpha.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(screen.getByRole('option', { name: /beta/ })).toHaveFocus();
    // Walking asked for nothing but the listing of the opened root.
    expect(calls.filter((call) => call.path === '/folders/list').map((call) => call.query)).toEqual([`path=${encodeURIComponent('/work')}`]);
    await userEvent.keyboard('{ArrowUp}{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('option', { name: /src/ })).toHaveFocus());
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('option', { name: /alpha/ })).toHaveFocus();
    expect(field().value).toBe('/work/alpha');
  });

  it('shows loading, an error with Retry in its column, an empty folder and a cut listing', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes({ ...TREE, '/work': { entries: TREE['/work'] as FolderEntryDto[], truncated: true } }), });
    render(<Host variant="columns" />);
    expect(await screen.findByText(/Only the first 300 folders are listed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /gamma/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('/work/gamma cannot be read');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /beta/ }));
    expect(await screen.findByText('No subfolder.')).toBeInTheDocument();
  });

  it('with no root says how to add one, and a failed roots request can be retried', async () => {
    stubFetch({ 'GET /folders/roots': { status: 409, body: { ok: false, error: { code: 'launch-roots-invalid', message: '/cfg/config.yml line 2: launchRoots must be a block list', hint: "run 'agent-manager launch-roots show'" } } } });
    render(<Host variant="columns" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('launchRoots must be a block list');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('V3 smart list', () => {
  const recent = (name: string, extra: Record<string, unknown> = {}) => ({ name, path: `/code/${name}`, hasGit: false, isRecent: true, isKnownProject: true, isLink: false, lastUsedAt: 5, uses: 1, exists: true, ...extra });

  it('lists the recent folders with their branch, pins one (kept in this browser), and picks on click', async () => {
    stubFetch({ 'GET /folders/recent': { body: { ok: true, warnings: [], folders: [recent('shop', { hasGit: true, branch: 'main' }), recent('blog')] } } });
    const onPick = vi.fn();
    render(<Host variant="smart" onPick={onPick} />);
    expect(await screen.findByRole('button', { name: /^shop/ })).toHaveTextContent('main');
    await userEvent.click(screen.getByRole('button', { name: 'Pin blog' }));
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? '[]')).toEqual(['/code/blog']);
    expect(within(screen.getByRole('list', { name: 'Pinned folders' })).getByRole('button', { name: /^blog/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpin blog' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /^shop/ }));
    expect(onPick).toHaveBeenCalledWith({ path: '/code/shop', name: 'shop', hasGit: true, branch: 'main' });
    expect(field().value).toBe('/code/shop');
    await userEvent.click(screen.getByRole('button', { name: 'Unpin blog' }));
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? 'x')).toEqual([]);
  });

  it('remembers the pins of the last time, and ignores a corrupt value saying so', async () => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(['/code/old']));
    stubFetch({});
    const first = render(<Host variant="smart" />);
    expect(await screen.findByRole('button', { name: /^old/ })).toBeInTheDocument();
    first.unmount();
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, '{"not":"a list"}');
    render(<Host variant="smart" />);
    expect(await screen.findByText(/pinned folders saved in this browser .* were ignored/)).toBeInTheDocument();
  });

  it('searches the known projects while typing, highlights the match, and picks the first with Enter without submitting', async () => {
    const onSubmit = vi.fn();
    const onPick = vi.fn();
    const { calls } = stubFetch({
      'GET /folders/search': (call) => {
        const q = new URLSearchParams(call.query).get('q');
        return { body: { ok: true, query: q, truncated: true, scanned: 12, warnings: [], results: [{ name: 'agent-manager', path: '/work/agent-manager', hasGit: true, isRecent: false, isKnownProject: true, isLink: false, branch: 'main' }] } };
      },
    });
    render(<Host variant="smart" onSubmit={onSubmit} onPick={onPick} />);
    await userEvent.type(screen.getByLabelText('Search the known projects'), 'agmgr{Enter}');
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ path: '/work/agent-manager', branch: 'main' })));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(calls.some((call) => call.path === '/folders/search' && call.query === 'q=agmgr')).toBe(true);
    expect(document.querySelector('[data-match]')).not.toBeNull();
    expect(screen.getByText(/More folders match: type more of the name/)).toBeInTheDocument();
  });

  it('is driven by the keyboard: Down enters the list, arrows walk it, Up from the first goes back to the search', async () => {
    stubFetch({ 'GET /folders/recent': { body: { ok: true, warnings: [], folders: [recent('shop'), recent('blog')] } } });
    render(<Host variant="smart" />);
    await screen.findByRole('button', { name: /^shop/ });
    screen.getByLabelText('Search the known projects').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /^shop/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /^blog/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByLabelText('Search the known projects')).toHaveFocus();
  });

  it('says what is empty (nothing recent, nothing found), what failed with Retry, a folder that is gone, and the warnings of the server', async () => {
    stubFetch({ 'GET /folders/recent': { body: { ok: true, warnings: ['The session registry cannot be read: missing folder. Start Claude Code once.'], folders: [] } } });
    const first = render(<Host variant="smart" />);
    expect(await screen.findByText(/No recent folder yet/)).toBeInTheDocument();
    expect(screen.getByText(/The session registry cannot be read/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search the known projects'), 'zzz');
    expect(await screen.findByText(/No known project matches "zzz"/)).toBeInTheDocument();
    first.unmount();

    stubFetch({ 'GET /folders/recent': { status: 500, body: { message: 'Unexpected failure: boom', hint: 'Run agent-manager cli logs' } } });
    const second = render(<Host variant="smart" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unexpected failure: boom. Run agent-manager cli logs');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    second.unmount();

    stubFetch({ 'GET /folders/recent': { body: { ok: true, warnings: [], folders: [recent('gone', { exists: false })] } } });
    render(<Host variant="smart" />);
    const gone = await screen.findByRole('button', { name: /^gone/ });
    expect(gone).toBeDisabled();
    expect(gone).toHaveTextContent('no longer exists');
  });

  it('a search that fails says why, with the text of the server', async () => {
    stubFetch({ 'GET /folders/search': { status: 400, body: { ok: false, error: { code: 'query-too-long', message: "'q' has 201 characters, the limit is 200", hint: 'Type fewer characters.' } } } });
    render(<Host variant="smart" />);
    await userEvent.type(screen.getByLabelText('Search the known projects'), 'a');
    expect(await screen.findByRole('alert')).toHaveTextContent("'q' has 201 characters, the limit is 200. Type fewer characters.");
  });
});

describe('V4 explorer', () => {
  it('starts in the first root, enters a folder (and picks it), goes back with a segment of the path bar and with Up', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes(TREE) });
    const onPick = vi.fn();
    render(<Host variant="explorer" onPick={onPick} />);
    const alpha = await screen.findByRole('button', { name: /^alpha/ });
    await userEvent.click(alpha);
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/work/alpha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open alpha' }));
    expect(await screen.findByRole('button', { name: /^src/ })).toBeInTheDocument();
    const bar = screen.getByRole('navigation', { name: 'Path' });
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['work', 'alpha']);
    expect(within(bar).getByRole('button', { name: 'alpha' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Up one folder' }));
    expect(await screen.findByRole('button', { name: /^beta/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Up one folder' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /^alpha/ }));
    await userEvent.dblClick(screen.getByRole('button', { name: /^alpha/ }));
    await userEvent.click(await within(screen.getByRole('navigation', { name: 'Path' })).findByRole('button', { name: 'work' }));
    expect(await screen.findByRole('button', { name: /^gamma/ })).toBeInTheDocument();
    expect(field().value).toBe('/work');
  });

  it('is driven by the keyboard: arrows walk, Enter enters, Left goes up, Space picks without entering', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes(TREE) });
    const onPick = vi.fn();
    render(<Host variant="explorer" onPick={onPick} />);
    const alpha = await screen.findByRole('button', { name: /^alpha/ });
    alpha.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /^beta/ })).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/work/beta' }));
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(await screen.findByRole('button', { name: /^src/ })).toBeInTheDocument();
    screen.getByRole('button', { name: /^src/ }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(await screen.findByRole('button', { name: /^beta/ })).toBeInTheDocument();
  });

  it('switches between several roots', async () => {
    const other = { path: '/data', name: 'data', source: 'sessions' as const };
    stubFetch({ ...rootsRoute([ROOT, other]), ...listRoutes({ ...TREE, '/data': [entry('/data', 'logs')] }) });
    render(<Host variant="explorer" />);
    await screen.findByRole('button', { name: /^alpha/ });
    await userEvent.selectOptions(screen.getByLabelText('Root folder'), '/data');
    expect(await screen.findByRole('button', { name: /^logs/ })).toBeInTheDocument();
  });

  it('says loading, an empty folder with what was left out, a cut listing, a failure with Retry, and no root', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes({ '/work': { entries: [], skipped: 2 } }) });
    const first = render(<Host variant="explorer" />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading');
    expect(await screen.findByText(/No subfolder in work\. 2 hidden or linked folders are not listed\./)).toBeInTheDocument();
    first.unmount();

    stubFetch({ ...rootsRoute(), ...listRoutes({ '/work': { entries: [entry('/work', 'a')], truncated: true } }) });
    const second = render(<Host variant="explorer" />);
    expect(await screen.findByText(/Only the first 300 folders are listed/)).toBeInTheDocument();
    second.unmount();

    stubFetch({ ...rootsRoute(), ...listRoutes({ '/work': { status: 404, code: 'folder-not-found', message: '/work does not exist' } }) });
    const third = render(<Host variant="explorer" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('/work does not exist. Fix it and retry');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    third.unmount();

    stubFetch({ ...rootsRoute([]) });
    render(<Host variant="explorer" />);
    expect(await screen.findByText(/Nothing to browse yet/)).toBeInTheDocument();
  });
});

describe('V5 palette', () => {
  it('lists the folders in one column: every group is a column, never two rows side by side', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes(TREE) });
    render(<Host variant="palette" />);
    await userEvent.type(field(), '/work/');
    const option = await screen.findByRole('option', { name: /alpha/ });
    expect(option.closest('[role="group"]')?.className).toContain('flex-col');
  });

  it('lists the folders under the typed path that start with the last segment, Tab completes the highlighted one and adds the separator', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes(TREE) });
    const onPick = vi.fn();
    render(<Host variant="palette" onPick={onPick} />);
    await userEvent.type(field(), '/work/a');
    expect(await screen.findByRole('option', { name: /alpha/ })).toHaveTextContent('main');
    expect(screen.queryByRole('option', { name: /beta/ })).toBeNull();
    await userEvent.keyboard('{Tab}');
    expect(field().value).toBe('/work/alpha/');
    // A completion keeps the text of the field and only tells the dialog about the folder.
    expect(onPick).not.toHaveBeenCalled();
    expect(document.querySelector('[data-picked-folder]')).toHaveTextContent('main');
    // The next segment: the subfolders of alpha are listed.
    expect(await screen.findByRole('option', { name: /src/ })).toBeInTheDocument();
    expect(field()).toHaveFocus();
  });

  it('Up and Down choose, Enter picks the highlighted folder without launching; Enter with none highlighted launches', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes(TREE) });
    const onSubmit = vi.fn();
    render(<Host variant="palette" onSubmit={onSubmit} />);
    await userEvent.type(field(), '/work/');
    await screen.findByRole('option', { name: /beta/ });
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant', expect.stringContaining('option-1'));
    expect(screen.getByRole('option', { name: /beta/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(field().value).toBe('/work/beta');
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a click on a suggestion picks it', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes(TREE) });
    render(<Host variant="palette" />);
    await userEvent.type(field(), '/work/');
    await userEvent.click(await screen.findByRole('option', { name: /gamma/ }));
    expect(field().value).toBe('/work/gamma');
  });

  it('a path outside the browsable folders is accepted as typed, said as information; a missing folder is an error', async () => {
    stubFetch({ ...rootsRoute(), ...listRoutes({ '/work': { status: 404, code: 'folder-not-found', message: '/work does not exist' } }) });
    const first = render(<Host variant="palette" />);
    await userEvent.type(field(), '/work/x');
    expect(await screen.findByRole('alert')).toHaveTextContent('/work does not exist');
    first.unmount();

    stubFetch({ ...rootsRoute(), ...listRoutes({}) });
    render(<Host variant="palette" />);
    await userEvent.type(field(), '/elsewhere/x');
    expect(await screen.findByText(/is outside the folders that can be browsed.*The path is used as typed\./)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a word without a separator searches the known projects; an empty field offers the recent folders and the roots', async () => {
    stubFetch({
      ...rootsRoute(),
      'GET /folders/recent': { body: { ok: true, warnings: [], folders: [{ name: 'shop', path: '/code/shop', hasGit: true, isRecent: true, isKnownProject: true, isLink: false, branch: 'dev', lastUsedAt: 1, uses: 1, exists: true }] } },
      'GET /folders/search': { body: { ok: true, query: 'blo', results: [{ name: 'blog', path: '/work/blog', hasGit: false, isRecent: false, isKnownProject: false, isLink: false }], truncated: false, scanned: 3, warnings: [] } },
    });
    render(<Host variant="palette" />);
    expect(await screen.findByRole('option', { name: /^shop/ })).toHaveTextContent('dev');
    expect(screen.getByRole('option', { name: '/work' })).toBeInTheDocument();
    await userEvent.type(field(), 'blo');
    expect(await screen.findByRole('option', { name: /^blog/ })).toHaveTextContent('/work/blog');
    await userEvent.keyboard('{Tab}');
    expect(field().value).toBe('/work/blog/');
  });

  it('says loading, and that nothing matches, when there is nothing to suggest', async () => {
    stubFetch({ ...rootsRoute(), 'GET /folders/list': () => new Promise<FakeAnswer>(() => undefined) });
    const first = render(<Host variant="palette" />);
    await userEvent.type(field(), '/work/');
    expect(await screen.findByRole('status', { name: '' })).toBeInTheDocument();
    expect(screen.getByText('Reading the folder...')).toBeInTheDocument();
    first.unmount();

    stubFetch({ ...rootsRoute(), ...listRoutes({ '/work': [] }) });
    render(<Host variant="palette" />);
    await userEvent.type(field(), '/work/zz');
    expect(await screen.findByText('Nothing matches. The path is used as typed.')).toBeInTheDocument();
  });
});
