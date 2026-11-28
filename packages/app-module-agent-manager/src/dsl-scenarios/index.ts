import { defineScenarios } from '@wadeck-app/app-core-sdk/scenarios';
import type { ScenarioHandler } from '@wadeck-app/app-core-sdk/scenarios';
import type { ScenarioRequest } from '@wadeck-app/app-core-sdk/scenarios';
import type {
  HcPermissionOk,
  LogEntry,
  LogOk,
  OwnedListOk,
  OwnedSessionDto,
  ReplyStatusOk,
  SessionRowDto,
  SessionsOk,
  TransportStatusDto,
} from '../commons/api.js';

/*
 * Mock backends of the Agents page for states that fixtures cannot reach: the folded texts behind "Show full", "Show N more", "Show all (N lines, M characters)" and
 * "Show all N" / "Show more". Every scenario lists one session to select (the others only fill the list). Nothing here is real: a write answers a plain ok.
 */

const BASE = '/api/modules/agent-manager';
const MINUTE = 60_000;

const LONG_QUOTE =
  'Please review the whole migration plan for the billing service before we start: the order of the steps, the rollback path of each step, the data we copy ' +
  'from the old tables, who owns the cut-over window, and what we tell the support team. I want a short list of risks first, then the detailed answer.';

const BASH_BODY = [
  'cd /work/shop && git stash push --include-untracked --message "before the cleanup"',
  'rm -rf build dist .cache coverage',
  'npm ci --no-audit --no-fund',
  'npm run build -- --mode production',
  'npm test -- --bail --reporter dot',
  'git stash pop',
  'echo "cleanup finished"',
].join('\n');

const REASONS = [
  'A turn is running: the assistant is answering "Review the migration plan"',
  'Waiting on a permission request for Bash: rm -rf build dist',
  'Sub-agent "Explore" is still running (started 2 minutes ago)',
  'Sub-agent "general-purpose" is still running (started 5 minutes ago)',
  'Tool Bash is running: npm test',
  'Background task "dev server" is still running',
  '2 queued messages are not answered yet',
];

function noReadiness(): SessionRowDto['adoptReadiness'] {
  return { state: 'free', reasons: [] };
}

interface RowInput {
  id: string;
  name: string;
  state: SessionRowDto['state'];
  status: string;
  minutesAgo: number;
  owned?: boolean;
  host?: SessionRowDto['host'];
  ownedState?: SessionRowDto['ownedState'];
  readiness?: SessionRowDto['adoptReadiness'];
  reason?: string;
}

function row(input: RowInput): SessionRowDto {
  const owned = input.owned === true;
  return {
    sessionId: input.id,
    displayName: input.name,
    folder: 'shop',
    cwd: '/work/shop',
    pid: 4000 + input.id.length,
    harness: 'Claude Code 2.1.330',
    harnessVariant: 'success',
    version: '2.1.330',
    status: input.status,
    alive: true,
    statusUpdatedAt: Date.now() - input.minutesAgo * MINUTE,
    state: input.state,
    pinned: false,
    pinOrder: -1,
    customGroupId: null,
    customGroupOrder: -1,
    flagged: false,
    unread: false,
    seen: true,
    reason: input.reason ?? '',
    lastActivity: 'Review the migration plan',
    activityNote: '',
    subagentCount: 0,
    launchedBy: owned ? 'agent-manager' : 'discovered',
    ...(owned ? { ownedId: input.id } : {}),
    host: owned ? (input.host ?? 'stream-json') : null,
    ...(owned ? { ownedState: input.ownedState ?? 'idle' } : {}),
    pendingPermissions: 0,
    adoptReadiness: input.readiness ?? noReadiness(),
    model: { id: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', known: true },
  };
}

function sessionsBody(rows: SessionRowDto[]): SessionsOk {
  return {
    ok: true,
    show: 'alive',
    generatedAt: new Date().toISOString(),
    sessions: rows,
    customGroups: [],
    userStateError: '',
    unreadable: [],
    unreadableText: '',
    hiddenDead: 0,
    emptyText: '',
    ownedError: null,
    ownedErrorText: '',
    ownedDown: null,
    ownedDownText: '',
    ownedStateErrorText: '',
  };
}

function userPrompt(index: number, uuid: string, text: string): LogEntry {
  return {
    kind: 'user-prompt',
    key: `p${index}`,
    offset: index * 100,
    timestamp: Date.now() - (20 - index) * MINUTE,
    uuid,
    source: 'human',
    queued: false,
    isMeta: false,
    text,
    textTruncated: false,
    textBytes: text.length,
    images: [],
  };
}

function assistantText(index: number, uuid: string, text: string): LogEntry {
  return {
    kind: 'assistant-text',
    key: `a${index}`,
    offset: index * 100,
    timestamp: Date.now() - (20 - index) * MINUTE,
    uuid,
    messageId: `msg_${index}`,
    model: 'claude-sonnet-5-5',
    text,
    textTruncated: false,
    textBytes: text.length,
  };
}

function logBody(sessionId: string, entries: LogEntry[]): LogOk {
  return {
    ok: true,
    sessionId,
    entries,
    cursor: 'c-end',
    olderCursor: null,
    more: false,
    subagents: [],
    subagentsNote: '',
    activity: { scope: 'window', runningToolCalls: [], tokensTotal: 1200, contextEstimate: 8000, turnsCount: entries.length, errorsCount: 0 },
    status: { model: { id: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', known: true } },
    truncated: { fieldsCut: 0, bodyCapped: false, unreadableLines: 0 },
    limits: { textChars: 20_000, inputChars: 8192, resultPreviewChars: 500, maxEntries: 500, maxBodyBytes: 1_000_000 },
    note: '',
  };
}

function transport(overrides: Partial<TransportStatusDto>): TransportStatusDto {
  return {
    transportId: 'socket',
    description: 'Claude Code socket (direct)',
    kind: 'direct',
    probed: true,
    available: true,
    reason: 'The session socket answers',
    fix: '',
    warnings: [],
    selected: true,
    isDefault: true,
    sessionOverride: false,
    deliveredAs: 'peer',
    deliveredAsText: 'peer message (wrapped by Claude Code)',
    marker: 'none',
    ...overrides,
  };
}

function replyStatus(sessionId: string, transports: TransportStatusDto[]): ReplyStatusOk {
  return {
    ok: true,
    sessionId,
    sessionAlive: true,
    selectedFrom: 'default',
    selectedTransportId: 'socket',
    defaultTransportId: 'socket',
    sessionOverrideTransportId: null,
    transports,
    replyMarker: { mode: 'none', source: 'default', text: 'Replies are sent as typed.' },
    messages: [],
    warnings: [],
    limits: { maxTextChars: 20_000, maxImages: 4, maxImageBytes: 500_000, maxBodyBytes: 1_000_000 },
  };
}

function ownedDto(id: string): OwnedSessionDto {
  return {
    id,
    hostKind: 'stream-json',
    cwd: '/work/shop',
    model: 'claude-sonnet-5-5',
    permissionMode: 'default',
    name: 'Billing migration',
    claudeVersion: '2.1.330',
    startedAt: Date.now() - 30 * MINUTE,
    status: 'live',
    state: 'running',
    resumable: false,
    pendingPermissions: 0,
    messages: [],
  };
}

function ownedList(dtos: OwnedSessionDto[]): OwnedListOk {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    daemon: {
      pid: 5000,
      startedAt: Date.now() - 60 * MINUTE,
      uptimeMs: 60 * MINUTE,
      owned: { total: dtos.length, live: dtos.length, idle: 0, running: dtos.length, requiresAction: 0, exited: 0, interrupted: 0, unobserved: 0 },
      leftovers: 0,
      stopping: false,
    },
    sessions: dtos,
  };
}

interface ScenarioData {
  rows: SessionRowDto[];
  entries: Record<string, LogEntry[]>;
  owned?: OwnedSessionDto[];
  replyStatuses?: Record<string, ReplyStatusOk>;
  hcPermissions?: Record<string, HcPermissionOk | { ok: false; error: { code: string; message: string; hint: string } }>;
}

// The routes the Agents page calls on load and on a selection, answered from `data`; every write answers a plain ok (the page is a mock).
function routesOf(data: ScenarioData): Record<string, ScenarioHandler> {
  const none = (): { body: { ok: true } } => ({ body: { ok: true } });
  const table: Record<string, ScenarioHandler> = {
    [`GET ${BASE}/csrf`]: () => ({ body: { ok: true, header: 'X-Agent-Manager-Csrf', token: 'mock-token' } }),
    [`GET ${BASE}/sessions`]: () => ({ body: sessionsBody(data.rows) }),
    [`GET ${BASE}/sessions/:id/log`]: ({ params, query }: ScenarioRequest) => {
      const id = params['id'] ?? '';
      const entries = query.get('after') === null ? (data.entries[id] ?? []) : [];
      return { body: logBody(id, entries) };
    },
    [`GET ${BASE}/sessions/:id/reply/status`]: ({ params }: ScenarioRequest) => {
      const id = params['id'] ?? '';
      return { body: data.replyStatuses?.[id] ?? replyStatus(id, [transport({})]) };
    },
    [`GET ${BASE}/sessions/:id/hc-permission`]: ({ params }: ScenarioRequest) => {
      const id = params['id'] ?? '';
      return { body: data.hcPermissions?.[id] ?? { ok: false, error: { code: 'no-terminal', message: 'This session was not started in a herdr-core terminal', hint: 'Start it with hc.' } } };
    },
    [`GET ${BASE}/owned`]: () => ({ body: ownedList(data.owned ?? []) }),
    [`GET ${BASE}/owned/:id/permissions`]: () => ({ body: { ok: true, permissions: [] } }),
    [`POST ${BASE}/sessions/:id/seen`]: none,
    [`POST ${BASE}/sessions/:id/pin`]: none,
  };
  return table;
}

const PAGES = ['/agents'];

export default defineScenarios([
  {
    id: 'thread-long-quote',
    label: 'Thread dialog with a long quote',
    hint: 'Select "Long quote", hover the long message in the log, open the thread button: the quote is cut at 3 lines behind "Show full".',
    pages: PAGES,
    create: () => {
      const id = '00000000-0000-4000-8000-000000000001';
      return {
        routes: routesOf({
          rows: [row({ id, name: 'Long quote', state: 'idle', status: 'idle', minutesAgo: 3 })],
          entries: { [id]: [userPrompt(1, 'u-long-1', LONG_QUOTE), assistantText(2, 'u-long-2', 'I will list the risks first, then go through the plan step by step.')] },
        }),
      };
    },
  },
  {
    id: 'hand-over-reasons',
    label: 'Hand-over with 7 reasons',
    hint: 'Select "Billing migration" and click the Hand over to Terminal icon in the header: the dialog lists 3 reasons and "Show 4 more".',
    pages: PAGES,
    create: () => {
      const id = '00000000-0000-4000-8000-000000000002';
      return {
        routes: routesOf({
          rows: [row({ id, name: 'Billing migration', state: 'working', status: 'busy', minutesAgo: 1, owned: true, host: 'stream-json', ownedState: 'running', readiness: { state: 'busy', reasons: REASONS } })],
          entries: { [id]: [userPrompt(1, 'u-hand-1', 'Review the migration plan'), assistantText(2, 'u-hand-2', 'Working on it.')] },
          owned: [ownedDto(id)],
        }),
      };
    },
  },
  {
    id: 'hc-permission-large',
    label: 'Terminal permission with a long command',
    hint: 'Select "Needs permission": the card above the reply box shows a 7-line command folded to 3 lines behind "Show all (7 lines, N characters)".',
    pages: PAGES,
    create: () => {
      const id = '00000000-0000-4000-8000-000000000003';
      return {
        routes: routesOf({
          rows: [row({ id, name: 'Needs permission', state: 'needs-you', status: 'waiting', minutesAgo: 1, reason: 'permission prompt' })],
          entries: { [id]: [userPrompt(1, 'u-hc-1', 'Clean the build folders and rebuild'), assistantText(2, 'u-hc-2', 'I need to run a few shell commands.')] },
          hcPermissions: {
            [id]: {
              ok: true,
              sessionId: id,
              state: 'prompt',
              prompt: {
                promptId: 'prompt-1',
                terminal: 't21',
                tool: 'Bash',
                header: 'Bash command',
                description: 'Clean the build folders and rebuild',
                body: BASH_BODY,
                notice: '',
                question: 'Do you want to proceed?',
                options: [
                  { number: 1, label: 'Yes' },
                  { number: 2, label: 'No' },
                ],
                statusMessage: '',
              },
            },
          },
        }),
      };
    },
  },
  {
    id: 'stacked-banners',
    label: 'Two messages stacked above the reply box',
    hint: 'Select "Stacked": the composer block (transport unavailable) and the terminal permission refusal (unsupported dialog) fold into one banner with "and 1 more" and "Show all 2".',
    pages: PAGES,
    create: () => {
      const id = '00000000-0000-4000-8000-000000000004';
      return {
        routes: routesOf({
          rows: [row({ id, name: 'Stacked', state: 'needs-you', status: 'waiting', minutesAgo: 1, reason: 'permission prompt' })],
          entries: { [id]: [userPrompt(1, 'u-st-1', 'Check the deploy'), assistantText(2, 'u-st-2', 'Waiting for a decision.')] },
          replyStatuses: {
            [id]: replyStatus(id, [
              transport({
                available: false,
                reason: 'The socket file of the session is missing and the plugin that creates it is not loaded in this Claude Code run, so replies cannot be delivered by the direct transport',
                fix: 'Start the session with the agent-manager plugin enabled, or select another transport in the transport picker, then reload.',
              }),
            ]),
          },
          hcPermissions: {
            [id]: {
              ok: true,
              sessionId: id,
              state: 'unsupported',
              terminal: 't21',
              code: 'dialog-too-long',
              reason: 'The terminal shows a dialog that is longer than this page shows whole, so it is not answered from here',
              fix: 'Answer it in the terminal t21.',
            },
          },
        }),
      };
    },
  },
  {
    id: 'single-long-banner',
    label: 'One long message above the reply box',
    hint: 'Select "Single": one composer block with a long text; the banner shows its first clause behind "Show more" (the FoldedBanner itself is only drawn without a stack, which no page does).',
    pages: PAGES,
    create: () => {
      const id = '00000000-0000-4000-8000-000000000005';
      return {
        routes: routesOf({
          rows: [row({ id, name: 'Single', state: 'idle', status: 'idle', minutesAgo: 2 })],
          entries: { [id]: [userPrompt(1, 'u-si-1', 'Check the deploy'), assistantText(2, 'u-si-2', 'The deploy is green.')] },
          replyStatuses: {
            [id]: replyStatus(id, [
              transport({
                available: false,
                reason: 'The socket file of the session is missing and the plugin that creates it is not loaded in this Claude Code run, so replies cannot be delivered by the direct transport',
                fix: 'Start the session with the agent-manager plugin enabled, or select another transport in the transport picker, then reload.',
              }),
            ]),
          },
        }),
      };
    },
  },
]);
