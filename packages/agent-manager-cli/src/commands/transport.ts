// agent-manager transport list | set | unset -- which reply transport carries the replies (socket, hc). No daemon: reads the Claude Code registry and <config folder>/transports.json.
import { readSessionRegistry, resolveSessionsDir } from '@wadeck-app/agent-manager-core';
import type { Session } from '@wadeck-app/agent-manager-core';
import {
  DELIVERED_AS_TEXT,
  ReplyError,
  createReplyService,
  implementedTransports,
  readTransportsConfig,
  setDefaultTransport,
  setSessionTransport,
  type TransportsConfig,
} from '@wadeck-app/agent-manager-core/reply';
import type { Command, CommandOutput, Context } from '../command.js';
import { CliError, UsageError, getErrorMessage } from '../errors.js';

const SESSION_OPTION = { session: { type: 'string', valueName: 'id', description: 'The session (its id, or the start of it when that is unambiguous); see the Agents page, or ~/.claude/sessions' } } as const;

/** What to say when a typed prompt is selected: it carries the authority of the user (threat model T-07/T-08). */
const TYPED_WARNING =
  'Replies on this transport are typed into the terminal as the user: the agent cannot tell them from your own typing (no wrapper, no peer warning). It is selected only where you set it; the default stays socket unless you change it.';

function ids(): string[] {
  return implementedTransports.map((transport) => transport.id);
}

/** A failure of the reply side already says what happened and what to do. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ReplyError) {
      throw new CliError(getErrorMessage(error));
    }
    throw error;
  }
}

async function readConfig(configDir: string): Promise<TransportsConfig> {
  return guarded(() => readTransportsConfig(configDir));
}

/** The session of `--session`: its full id, or a prefix that matches exactly one session of the registry. */
async function findSession(context: Context, wanted: string): Promise<Session> {
  const dir = resolveSessionsDir(context.env);
  const registry = await readSessionRegistry(dir);
  if (!registry.ok) {
    const { message, hint } = registry.error;
    throw new CliError(`${message}. ${hint}`);
  }
  const lower = wanted.toLowerCase();
  const exact = registry.sessions.filter((session) => session.sessionId.toLowerCase() === lower);
  const matches = exact.length > 0 ? exact : lower.length >= 4 ? registry.sessions.filter((session) => session.sessionId.toLowerCase().startsWith(lower)) : [];
  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length > 1) {
    throw new CliError(`'${wanted}' matches ${matches.length} sessions (${matches.map((session) => session.sessionId).join(', ')}): give more characters of the id`);
  }
  throw new CliError(`no session '${wanted}' in the Claude Code registry ${dir} (${registry.sessions.length} session(s) there; an id prefix needs at least 4 characters). Use the id shown in the Agents page`);
}

function sessionOption(context: Context): string | undefined {
  const value = context.options.value('session');
  if (value !== undefined && value.trim() === '') {
    throw new UsageError("option '--session' needs a session id", 'agent-manager transport');
  }
  return value?.trim();
}

function idColumn(): number {
  return Math.max(...ids().map((id) => id.length));
}

const listCommand: Command = {
  name: 'transport list',
  summary: 'List the reply transports, how each delivers, and the selected one; with --session also whether each works for that session now',
  args: [],
  options: SESSION_OPTION,
  run: async (context): Promise<CommandOutput> => {
    const config = await readConfig(context.configDir);
    const wanted = sessionOption(context);
    const width = idColumn();
    if (wanted === undefined) {
      const lines = [`Default transport: ${config.default}`];
      for (const transport of implementedTransports) {
        lines.push(`  ${transport.id === config.default ? '*' : ' '} ${transport.id.padEnd(width)}  delivered as: ${DELIVERED_AS_TEXT[transport.deliveredAs]}`, `      ${transport.describe()}`);
      }
      const overrides = Object.entries(config.perSession);
      lines.push(overrides.length === 0 ? 'No session has its own transport.' : `Sessions with their own transport: ${overrides.map(([session, id]) => `${session} -> ${id}`).join(', ')}`);
      lines.push("Availability depends on the session: run 'agent-manager transport list --session <id>'.");
      return {
        json: {
          defaultTransportId: config.default,
          perSession: config.perSession,
          transports: implementedTransports.map((transport) => ({ id: transport.id, kind: transport.kind, deliveredAs: transport.deliveredAs, deliveredAsText: DELIVERED_AS_TEXT[transport.deliveredAs], description: transport.describe() })),
        },
        lines,
      };
    }
    const session = await findSession(context, wanted);
    const service = createReplyService({ configDir: context.configDir, transports: implementedTransports, readSessions: () => readSessionRegistry(resolveSessionsDir(context.env)) });
    const [status] = await guarded(() => service.getTransportStatus([session], { probe: 'all' }));
    if (status === undefined) {
      throw new CliError('the reply service returned no transport status (this is a bug of agent-manager, please report it)');
    }
    const lines = [`Session ${session.sessionId} (${session.name ?? session.folder}): selected transport ${status.selectedTransportId}${status.sessionOverrideTransportId === null ? ` (the default)` : ' (its own setting)'}`];
    for (const entry of status.transports) {
      const selected = entry.transportId === status.selectedTransportId ? '*' : ' ';
      lines.push(`  ${selected} ${entry.transportId.padEnd(width)}  ${entry.probe.available ? 'available    ' : 'NOT available'}  delivered as: ${DELIVERED_AS_TEXT[entry.deliveredAs]}`);
      lines.push(`      ${entry.probe.reason}`);
      if (!entry.probe.available && entry.probe.fix !== '') {
        lines.push(`      Fix: ${entry.probe.fix}`);
      }
      const warnings: unknown = entry.probe.details['warnings'];
      for (const warning of Array.isArray(warnings) ? warnings : []) {
        lines.push(`      Warning: ${String(warning)}`);
      }
    }
    return {
      json: {
        sessionId: session.sessionId,
        selectedTransportId: status.selectedTransportId,
        defaultTransportId: status.defaultTransportId,
        sessionOverrideTransportId: status.sessionOverrideTransportId,
        transports: status.transports.map((entry) => ({
          id: entry.transportId,
          selected: entry.transportId === status.selectedTransportId,
          available: entry.probe.available,
          reason: entry.probe.reason,
          fix: entry.probe.fix,
          warnings: entry.probe.details['warnings'] ?? [],
          deliveredAs: entry.deliveredAs,
          deliveredAsText: DELIVERED_AS_TEXT[entry.deliveredAs],
        })),
      },
      lines,
    };
  },
};

const setCommand: Command = {
  name: 'transport set',
  summary: `Select the reply transport (${ids().join(' | ')}): the default for every session, or with --session for one session only. Nothing is sent`,
  args: ['id'],
  options: SESSION_OPTION,
  run: async (context, args): Promise<CommandOutput> => {
    const id = args[0]!;
    const wanted = sessionOption(context);
    const session = wanted === undefined ? undefined : await findSession(context, wanted);
    const config = await guarded(() => (session === undefined ? setDefaultTransport(context.configDir, id, ids()) : setSessionTransport(context.configDir, session.sessionId, id, ids())));
    const typed = implementedTransports.find((transport) => transport.id === id)?.deliveredAs === 'typed';
    const what = session === undefined ? `The default transport is now '${id}'` : `Session ${session.sessionId} now uses '${id}'`;
    const sessions = session === undefined ? Object.entries(config.perSession).filter(([, own]) => own !== id).map(([sessionId, own]) => `${sessionId} (${own})`) : [];
    const lines = [what, ...(typed ? [`Warning: ${TYPED_WARNING}`] : []), ...(sessions.length === 0 ? [] : [`Not changed, they keep their own transport: ${sessions.join(', ')}`]), "Check that it works: 'agent-manager transport list --session <id>'"];
    return { json: { ok: true, defaultTransportId: config.default, sessionId: session?.sessionId ?? null, sessionOverrideTransportId: session === undefined ? null : (config.perSession[session.sessionId] ?? null), ...(typed ? { warning: TYPED_WARNING } : {}) }, lines };
  },
};

const unsetCommand: Command = {
  name: 'transport unset',
  summary: 'Remove the transport of one session: it follows the default again (--session is required: the default is changed with transport set)',
  args: [],
  options: SESSION_OPTION,
  run: async (context): Promise<CommandOutput> => {
    const wanted = sessionOption(context);
    if (wanted === undefined) {
      throw new UsageError("'transport unset' needs --session <id>; to change the default transport use 'agent-manager transport set <id>'", 'agent-manager transport unset');
    }
    // A stale override of a session that ended must stay removable: a full id that is not in the registry is accepted as it is.
    let sessionId = wanted;
    try {
      sessionId = (await findSession(context, wanted)).sessionId;
    } catch (error) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(wanted) || wanted.length < 8) {
        throw error;
      }
      const config = await readConfig(context.configDir);
      if (config.perSession[wanted] === undefined) {
        throw new CliError(`${getErrorMessage(error)}; and transports.json has no setting for '${wanted}' either`);
      }
    }
    const config = await guarded(() => setSessionTransport(context.configDir, sessionId, null, ids()));
    return { json: { ok: true, sessionId, defaultTransportId: config.default }, lines: [`Session ${sessionId} follows the default transport again (${config.default})`] };
  },
};

export const TRANSPORT_COMMANDS: Command[] = [listCommand, setCommand, unsetCommand];
