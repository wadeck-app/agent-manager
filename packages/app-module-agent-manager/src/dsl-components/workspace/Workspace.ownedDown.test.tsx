import { render, screen } from '@testing-library/react';
import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { describe, expect, it } from 'vitest';
import { stubFetch } from '../owned/testFetch.js';
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
  it('shows a persistent warning with the count and the fix command', () => {
    show({ ownedDownText: TEXT });
    const banner = screen.getByText(TEXT);
    expect(banner.closest('[role="status"]')).not.toBeNull();
    expect(banner.textContent).toContain('agent-manager start --detach');
  });

  it('shows the state file problem as its own warning', () => {
    show({ ownedStateErrorText: 'the file of owned sessions X cannot be used (not valid JSON)' });
    expect(screen.getByText(/cannot be used \(not valid JSON\)/)).toBeTruthy();
  });

  it('shows nothing when there is nothing to say', () => {
    show({});
    expect(screen.queryByText(/owned sessions/)).toBeNull();
  });
});
