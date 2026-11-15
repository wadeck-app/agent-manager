import type { ReplyStatusOk } from '../deps.js';

/** A GET reply/status answer for tests: one selected `socket` transport, one audited message. */
export function statusFixture(options: { sessionAlive?: boolean; transportAvailable?: boolean } = {}): ReplyStatusOk {
  const available = options.transportAvailable ?? true;
  return {
    ok: true,
    sessionId: 's',
    sessionAlive: options.sessionAlive ?? true,
    selectedFrom: 'default',
    selectedTransportId: 'socket',
    defaultTransportId: 'socket',
    sessionOverrideTransportId: null,
    transports: [
      {
        transportId: 'socket',
        description: 'writes into the inbox socket',
        kind: 'direct',
        available,
        reason: available ? 'socket reachable' : 'no token file',
        fix: available ? '' : 'create the token file',
        warnings: [],
        selected: true,
        probed: true,
        isDefault: true,
        sessionOverride: false,
        deliveredAs: 'peer',
        deliveredAsText: 'peer message (wrapped by Claude Code)',
      },
    ],
    messages: [{ messageId: 'm1', sentAt: 1_000, text: 'earlier', imageCount: 0, transportId: 'socket', priority: 'next', state: 'confirmed', ui: 'seen', reason: 'echoed', hint: '' }],
    warnings: [],
    limits: { maxTextChars: 1000, maxImages: 2, maxImageBytes: 100_000, maxBodyBytes: 1_048_576 },
  };
}
