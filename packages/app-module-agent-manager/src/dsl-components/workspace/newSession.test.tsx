import { hoverTip, liveTooltip } from '../detail/status/liveTooltip.js';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownedDto, row } from '../logic/fixtures.js';
import { DEFAULT_UI_VARIANTS } from '../logic/uiVariants.js';
import { UiVariantsContext } from '../ui/UiVariants.js';
import { stubFetch } from '../owned/testFetch.js';
import { Workspace } from './Workspace.js';

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const ID = '33333333-3333-4333-8333-333333333333';

function Page({ ownedError = null }: { ownedError?: { code: string; message: string; hint: string } | null }) {
  const [params, setParams] = useState<Record<string, string>>({});
  const service: UrlParamService = { get: (key) => params[key] ?? null, set: (key, value) => setParams((current) => ({ ...current, [key]: value })) };
  return (
    // The compact row of the A/B question ui-tree-density: it writes the host and the Starting chip (the Herdr row keeps the host in a tooltip).
    <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS, treeDensity: 'compact' }}>
    <UrlParamContext.Provider value={service}>
      {/* violations-suppress: shared/no-out-of-repo-path a Windows path as the user types it, never read from disk */}
      <Workspace sessions={[row({ folder: 'shop', cwd: 'C:\\Projects\\shop' })]} userStateError="" hiddenDead={0} ownedError={ownedError} ownedErrorText={ownedError === null ? '' : `${ownedError.message}. ${ownedError.hint}`} />
      <div data-testid="session-param">{params['session'] ?? ''}</div>
    </UrlParamContext.Provider>
    </UiVariantsContext.Provider>
  );
}

describe('the New session entry of the toolbar', () => {
  it('opens the dialog, launches, lists the new session at once as starting, and selects it', async () => {
    // violations-suppress: shared/no-out-of-repo-path a Windows path as the user types it, never read from disk
    stubFetch({
      // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
      'POST /owned/launch': { body: { ok: true, session: ownedDto({ id: ID, cwd: 'C:\\Projects\\shop', name: 'Fresh' }) } },
      // The server lists the folder of the one session among the recent ones.
      // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
      'GET /folders/recent': { body: { ok: true, warnings: [], folders: [{ name: 'shop', path: 'C:\\Projects\\shop', hasGit: false, isRecent: true, isKnownProject: true, isLink: false, lastUsedAt: 1, uses: 1, exists: true }] } },
    });
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeInTheDocument();
    // The folder of the one listed session is offered.
    await userEvent.click(await screen.findByRole('button', { name: /^shop/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Launch' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New session' })).toBeNull());
    expect(screen.getByTestId('session-param')).toHaveTextContent(ID);
    const rowElement = document.querySelector(`[data-session-id="${ID}"]`) as HTMLElement;
    // The compact Tree row keeps the detail line in its tooltip; the chip says Starting.
    hoverTip(rowElement.querySelector<HTMLElement>('[data-tip-fill], [data-tip-fit]') as HTMLElement);
    expect(liveTooltip()).toHaveTextContent('Starting... no transcript yet');
    expect(rowElement).toHaveTextContent('Starting...');
    expect(rowElement).toHaveTextContent('Web');
    expect(rowElement).toHaveAttribute('aria-selected', 'true');
  });

  it('with the daemon not running the dialog shows the command and Launch stays disabled', async () => {
    stubFetch({});
    render(<Page ownedError={{ code: 'daemon-not-running', message: 'The agent-manager daemon is not running', hint: 'Run agent-manager start --detach' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(document.querySelector('[data-daemon-command]')).toHaveTextContent('agent-manager start --detach');
    expect(screen.getByRole('button', { name: 'Launch' })).toBeDisabled();
  });
});
