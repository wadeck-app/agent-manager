import { randomBytes } from 'node:crypto';
import type { HostEvent, HostEventType } from './types.js';

export const DEFAULT_EVENT_CAPACITY = 1000;

type Subscriber = (event: HostEvent) => void;

export interface ReplayResult {
  /** The events after the given id, oldest first. */
  events: HostEvent[];
  /** True when the consumer asked to continue after an id that is gone (or from another daemon run): it must refetch the sessions. */
  gap: boolean;
  /** Why there is a gap. */
  gapReason?: 'daemon-restarted' | 'events-dropped' | 'unknown-id';
}

/**
 * The events of the host: a ring of the last `capacity` events (bounded memory), live subscribers, and replay after an id. Ids are
 * `<epoch>:<n>`; the epoch is new at every daemon start, so an id from an earlier run is recognised as such and never mistaken for a position
 * in this run. A subscriber that throws is dropped from the delivery of that event only and the error is handed to `onSubscriberError`.
 */
export class EventLog {
  readonly epoch: string;
  readonly #capacity: number;
  readonly #events: HostEvent[] = [];
  readonly #subscribers = new Set<Subscriber>();
  readonly #clock: () => number;
  readonly #onSubscriberError: (error: unknown) => void;
  #next = 1;

  constructor(options: { capacity?: number; clock?: () => number; epoch?: string; onSubscriberError?: (error: unknown) => void } = {}) {
    this.#capacity = options.capacity ?? DEFAULT_EVENT_CAPACITY;
    this.#clock = options.clock ?? Date.now;
    this.epoch = options.epoch ?? randomBytes(4).toString('hex');
    this.#onSubscriberError = options.onSubscriberError ?? (() => undefined);
  }

  get size(): number {
    return this.#events.length;
  }

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  /** The id of the newest event, or undefined when none was emitted yet. */
  get lastId(): string | undefined {
    return this.#events.at(-1)?.id;
  }

  append(type: HostEventType, sessionId: string | undefined, data: Record<string, unknown> = {}): HostEvent {
    const event: HostEvent = { id: `${this.epoch}:${this.#next++}`, time: this.#clock(), type, ...(sessionId === undefined ? {} : { sessionId }), data };
    this.#events.push(event);
    if (this.#events.length > this.#capacity) {
      this.#events.shift();
    }
    for (const subscriber of [...this.#subscribers]) {
      try {
        subscriber(event);
      } catch (error) {
        this.#onSubscriberError(error);
      }
    }
    return event;
  }

  subscribe(subscriber: Subscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  /** The events after `afterId` (all the buffered ones when it is undefined). */
  replay(afterId: string | undefined): ReplayResult {
    if (afterId === undefined) {
      return { events: [...this.#events], gap: false };
    }
    const separator = afterId.indexOf(':');
    const epoch = separator === -1 ? '' : afterId.slice(0, separator);
    const position = Number(separator === -1 ? Number.NaN : afterId.slice(separator + 1));
    if (separator === -1 || !Number.isInteger(position) || position < 0) {
      return { events: [...this.#events], gap: true, gapReason: 'unknown-id' };
    }
    if (epoch !== this.epoch) {
      return { events: [...this.#events], gap: true, gapReason: 'daemon-restarted' };
    }
    const first = this.#events[0];
    const firstPosition = first === undefined ? this.#next : Number(first.id.slice(first.id.indexOf(':') + 1));
    // The consumer has seen everything before `position`; the oldest event kept must be at most position + 1, else some are gone.
    if (position + 1 < firstPosition) {
      return { events: [...this.#events], gap: true, gapReason: 'events-dropped' };
    }
    return { events: this.#events.filter((event) => Number(event.id.slice(event.id.indexOf(':') + 1)) > position), gap: false };
  }
}
