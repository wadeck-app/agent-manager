import { describe, expect, it } from 'vitest';
import { switchViewOf } from './adoptSwitch.js';
import { ownedRow, row } from './fixtures.js';
import { applyReadinessPreview } from './readinessPreview.js';

describe('the Move readiness preview of the dev dock', () => {
  it('real: the session is returned as is', () => {
    const session = row({ displayName: 'one' });
    const result = applyReadinessPreview(session, 'real');
    expect(result.session).toBe(session);
    expect(result.synthetic).toBe(false);
  });

  it('an agent started here keeps its identity and only its readiness is forced', () => {
    const session = ownedRow({ adoptReadiness: { state: 'free', reasons: [] } });
    const busy = applyReadinessPreview(session, 'busy');
    expect(busy.synthetic).toBe(false);
    expect(busy.session.sessionId).toBe(session.sessionId);
    expect(busy.session.adoptReadiness).toEqual({ state: 'busy', reasons: ['A turn is running', 'Tool Bash is running'] });
    expect(switchViewOf(busy.session)?.readiness).toBe('busy');
    expect(applyReadinessPreview(session, 'unknown').session.adoptReadiness?.state).toBe('unknown');
    expect(applyReadinessPreview(ownedRow({ adoptReadiness: { state: 'busy', reasons: ['x'] } }), 'free').session.adoptReadiness).toEqual({ state: 'free', reasons: [] });
  });

  it('an agent that cannot move (discovered, ended) becomes a synthetic live Web agent, so that every look has a Move button to show', () => {
    for (const session of [row({ alive: true }), row({ alive: false }), ownedRow({ host: 'bg' })]) {
      for (const state of ['free', 'busy', 'unknown'] as const) {
        const result = applyReadinessPreview(session, state);
        expect(result.synthetic).toBe(true);
        expect(result.session.sessionId).toBe(session.sessionId);
        expect(switchViewOf(result.session)?.readiness).toBe(state);
      }
    }
  });
});
