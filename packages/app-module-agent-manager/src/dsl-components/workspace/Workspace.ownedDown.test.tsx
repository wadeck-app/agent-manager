import { fireEvent, render, screen } from '@testing-library/react';
import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { describe, expect, it } from 'vitest';
import { stubFetch } from '../owned/testFetch.js';
import { expectNoticeDetails } from '../ui/noticeTestKit.js';
import { Workspace } from './Workspace.js';

const TEXT = '2 owned sessions are listed in owned-sessions.json but the daemon is not running: their Stop, Resume and Move actions are unavailable. Run `agent-manager start --detach`.';
const service: UrlParamService = { get: () => null, set: () => undefined };

function show(props: { ownedDownText?: string; ownedStateErrorText?: string }) {
  stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [] } } });
  return render(
    <UrlParamContext.Provider value={service}>
      <Workspace sessions={[]} userStateError="" hiddenDead={0} ownedError={null} ownedErrorText="" {...props} />
    </UrlParamContext.Provider>,
  );
}

describe('Workspace: owned sessions without a daemon', () => {
  it('shows no inline notice: one button in the toolbar, the sentence and a Copy fix button in its panel', async () => {
    show({ ownedDownText: TEXT });
    expect(screen.queryByText('Daemon off: 2 owned sessions unavailable')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1 notice' }));
    expect(screen.getByText('Daemon off: 2 owned sessions unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy fix' })).toBeInTheDocument();
    await expectNoticeDetails(/2 owned sessions are listed in owned-sessions.json but the daemon is not running/);
  });

  it('shows the state file problem as its own notice', async () => {
    show({ ownedStateErrorText: 'the file of owned sessions X cannot be used (not valid JSON)' });
    await expectNoticeDetails(/cannot be used \(not valid JSON\)/);
    expect(screen.getByText('Owned sessions file unusable')).toBeInTheDocument();
  });

  it('two problems are ONE button counting 2, both in its panel', () => {
    show({ ownedDownText: TEXT, ownedStateErrorText: 'the file of owned sessions X cannot be used (not valid JSON)' });
    fireEvent.click(screen.getByRole('button', { name: '2 notices' }));
    expect(screen.getByText('Daemon off: 2 owned sessions unavailable')).toBeInTheDocument();
    expect(screen.getByText('Owned sessions file unusable')).toBeInTheDocument();
  });

  it('the button sits immediately left of New group (Tree), and a dismissed notice can be restored from the panel while another is active', () => {
    show({ ownedDownText: TEXT, ownedStateErrorText: 'the file of owned sessions X cannot be used (not valid JSON)' });
    const button = screen.getByRole('button', { name: '2 notices' });
    expect(button.closest('[data-notices-slot]')?.nextElementSibling?.textContent).toMatch(/new group/i);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss: Daemon off/ }));
    expect(screen.queryByText('Daemon off: 2 owned sessions unavailable')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore 1 dismissed' }));
    expect(screen.getByText('Daemon off: 2 owned sessions unavailable')).toBeInTheDocument();
  });

  it('shows nothing when there is nothing to say', () => {
    show({});
    expect(screen.queryByText(/owned sessions/)).toBeNull();
    expect(screen.queryByRole('button', { name: /notices?$/ })).toBeNull();
  });
});
