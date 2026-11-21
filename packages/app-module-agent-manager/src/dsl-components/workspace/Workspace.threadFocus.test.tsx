import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answer, userPrompt } from '../detail/log/entryFixtures.js';
import { resetPending } from '../detail/pending.js';
import { ownedRow, row } from '../logic/fixtures.js';
import { stubFetch } from '../owned/testFetch.js';
import { Workspace } from './Workspace.js';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  resetPending();
  Element.prototype.scrollIntoView = vi.fn();
});

const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THREAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ANCHOR = '27bf9648-39df-453b-bd04-99816f5c1819';

function Page({ sessions }: { sessions: ReturnType<typeof row>[] }) {
  const [params, setParams] = useState<Record<string, string>>({ session: THREAD });
  const service: UrlParamService = { get: (key) => params[key] ?? null, set: (key, value) => setParams((current) => ({ ...current, [key]: value })) };
  return (
    <UrlParamContext.Provider value={service}>
      <Workspace sessions={sessions} userStateError="" hiddenDead={0} ownedError={null} ownedErrorText="" />
      <div data-testid="session-param">{params['session'] ?? ''}</div>
      <button type="button" onClick={() => service.set('session', SOURCE)}>
        url-select-source
      </button>
    </UrlParamContext.Provider>
  );
}

function stubLogs() {
  stubFetch({
    'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [] } },
    [`GET /sessions/${SOURCE}/log`]: { body: answer([{ ...userPrompt('anchor', 'the anchor message'), uuid: ANCHOR }]) },
    [`GET /sessions/${THREAD}/log`]: { body: answer([]) },
    [`GET /sessions/${OTHER}/log`]: { body: answer([]) },
  });
}

const sessions = () => [
  row({ sessionId: SOURCE, displayName: 'shop' }),
  ownedRow({ sessionId: THREAD, displayName: 'thread of shop', forkedFrom: SOURCE, threadOf: { sessionId: SOURCE, messageId: ANCHOR } }),
  row({ sessionId: OTHER, displayName: 'other' }),
];

const hot = (): Element | null => document.querySelector('[data-hot="true"]');

describe('the link back from a thread, in the workspace', () => {
  it('opens the source and pulses the anchor row', async () => {
    stubLogs();
    render(<Page sessions={sessions()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Go to the message/ }));
    await waitFor(() => expect(screen.getByTestId('session-param')).toHaveTextContent(SOURCE));
    await waitFor(() => expect(hot()).not.toBeNull());
    expect(hot()?.textContent).toContain('the anchor message');
  });

  it('the focus does not survive leaving the source by the back button: opening the source again from the list does not pulse', async () => {
    stubLogs();
    render(<Page sessions={sessions()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Go to the message/ }));
    await waitFor(() => expect(hot()).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    await waitFor(() => expect(screen.getByTestId('session-param')).toHaveTextContent(/^$/));
    await userEvent.click(document.querySelector(`[data-session-id="${SOURCE}"]`) as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('session-param')).toHaveTextContent(SOURCE));
    await screen.findByText('the anchor message');
    expect(hot()).toBeNull();
  });

  it('the focus does not survive a selection made through the url parameter either', async () => {
    stubLogs();
    render(<Page sessions={sessions()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Go to the message/ }));
    await waitFor(() => expect(hot()).not.toBeNull());
    // Leaves by a path that is not a click in the list (the back button), then the url parameter brings the source back.
    await userEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    await waitFor(() => expect(screen.getByTestId('session-param')).toHaveTextContent(/^$/));
    await userEvent.click(screen.getByRole('button', { name: 'url-select-source' }));
    await waitFor(() => expect(screen.getByTestId('session-param')).toHaveTextContent(SOURCE));
    await screen.findByText('the anchor message');
    expect(hot()).toBeNull();
  });
});
