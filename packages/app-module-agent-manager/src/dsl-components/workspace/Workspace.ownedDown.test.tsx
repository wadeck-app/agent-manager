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
  it('shows ONE short line with the sentence and a Copy fix button, the full text behind Details', async () => {
    show({ ownedDownText: TEXT });
    const line = screen.getByText('Daemon off: 2 owned sessions unavailable');
    expect(line.closest('[role="status"]')).not.toBeNull();
    // The line is short: the long text (file, why) is not on the page until Details is opened.
    expect(screen.queryByText(/their Stop, Resume and Move actions are unavailable/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy fix' })).toBeInTheDocument();
    await expectNoticeDetails(/2 owned sessions are listed in owned-sessions.json but the daemon is not running/);
  });

  it('shows the state file problem as its own notice', async () => {
    show({ ownedStateErrorText: 'the file of owned sessions X cannot be used (not valid JSON)' });
    expect(screen.getByText('Owned sessions file unusable')).toBeInTheDocument();
    await expectNoticeDetails(/cannot be used \(not valid JSON\)/);
  });

  it('two problems are ONE line "2 notices"', () => {
    show({ ownedDownText: TEXT, ownedStateErrorText: 'the file of owned sessions X cannot be used (not valid JSON)' });
    expect(screen.getByText('2 notices')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('Daemon off: 2 owned sessions unavailable')).toBeInTheDocument();
    expect(screen.getByText('Owned sessions file unusable')).toBeInTheDocument();
  });

  it('a dismissed notice leaves a badge in the toolbar and comes back from it', () => {
    show({ ownedDownText: TEXT });
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }));
    expect(screen.queryByText('Daemon off: 2 owned sessions unavailable')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1 notice dismissed' }));
    expect(screen.getByText('Daemon off: 2 owned sessions unavailable')).toBeInTheDocument();
  });

  it('shows nothing when there is nothing to say', () => {
    show({});
    expect(screen.queryByText(/owned sessions/)).toBeNull();
    expect(screen.queryByText(/dismissed/)).toBeNull();
  });
});
