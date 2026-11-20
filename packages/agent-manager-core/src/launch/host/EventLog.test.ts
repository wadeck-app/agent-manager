import { describe, expect, it } from 'vitest';
import { EventLog } from './EventLog.js';

describe('EventLog', () => {
  it('numbers events per epoch and delivers them to subscribers in order', () => {
    const log = new EventLog({ epoch: 'e1', clock: () => 5 });
    const seen: string[] = [];
    const unsubscribe = log.subscribe((event) => seen.push(event.id));
    log.append('session.state', 's1', { state: 'idle' });
    log.append('session.state', 's1', { state: 'running' });
    unsubscribe();
    log.append('session.state', 's1', { state: 'idle' });
    expect(seen).toEqual(['e1:1', 'e1:2']);
    expect(log.lastId).toBe('e1:3');
    expect(log.subscriberCount).toBe(0);
  });

  it('keeps only the last `capacity` events', () => {
    const log = new EventLog({ capacity: 3, epoch: 'e' });
    for (let i = 0; i < 10; i++) {
      log.append('host.warning', undefined, { i });
    }
    expect(log.size).toBe(3);
    expect(log.replay(undefined).events.map((event) => event.id)).toEqual(['e:8', 'e:9', 'e:10']);
  });

  it('replays after a known id without a gap', () => {
    const log = new EventLog({ capacity: 5, epoch: 'e' });
    for (let i = 0; i < 4; i++) {
      log.append('host.warning', undefined);
    }
    expect(log.replay('e:2')).toEqual({ events: [expect.objectContaining({ id: 'e:3' }), expect.objectContaining({ id: 'e:4' })], gap: false });
    expect(log.replay('e:4')).toEqual({ events: [], gap: false });
  });

  it('reports a gap when the events after the id were dropped', () => {
    const log = new EventLog({ capacity: 3, epoch: 'e' });
    for (let i = 0; i < 10; i++) {
      log.append('host.warning', undefined);
    }
    // The consumer saw e:5: e:6 is gone.
    expect(log.replay('e:5')).toMatchObject({ gap: true, gapReason: 'events-dropped' });
    // It saw e:7: e:8 is the oldest kept, nothing is missing.
    expect(log.replay('e:7')).toMatchObject({ gap: false });
  });

  it('recognises an id of an earlier daemon run and a malformed id', () => {
    const log = new EventLog({ epoch: 'new' });
    log.append('host.warning', undefined);
    expect(log.replay('old:99')).toMatchObject({ gap: true, gapReason: 'daemon-restarted' });
    expect(log.replay('garbage')).toMatchObject({ gap: true, gapReason: 'unknown-id' });
    expect(log.replay('new:x')).toMatchObject({ gap: true, gapReason: 'unknown-id' });
  });

  it('isolates a subscriber that throws and reports it', () => {
    const errors: unknown[] = [];
    const log = new EventLog({ onSubscriberError: (error) => errors.push(error) });
    const seen: string[] = [];
    log.subscribe(() => {
      throw new Error('boom');
    });
    log.subscribe((event) => seen.push(event.type));
    log.append('host.warning', undefined);
    expect(seen).toEqual(['host.warning']);
    expect(errors).toHaveLength(1);
  });
});
