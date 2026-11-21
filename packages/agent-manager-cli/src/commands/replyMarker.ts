// agent-manager reply-marker show | set <none|short|full> -- the origin marker line of the replies sent from the web UI (setting `replyMarker` of <config folder>/config.yml). No daemon.
import { DEFAULT_REPLY_MARKER, REPLY_MARKER_MODES, ReplyError, readReplyMarker, setReplyMarker, type ReplyMarkerMode } from '@wadeck-app/agent-manager-core/reply';
import type { Command, CommandOutput } from '../command.js';
import { CliError, getErrorMessage } from '../errors.js';

const EXAMPLE: Record<ReplyMarkerMode, string> = {
  none: 'no marker line: the session receives the text exactly as typed',
  short: 'a first line [agent-manager-web #<id>] before the text',
  full: 'a first line [web reply via agent-manager #<id>] before the text',
};

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

const NOTES = ['Delivery confirmation does not depend on the marker (socket: origin.msg_id; hc: the text and the time).', 'A transport that never adds a marker (owned sessions) sends the text as typed whatever this says.'];

const showCommand: Command = {
  name: 'reply-marker show',
  summary: `Show the marker line replies start with (${REPLY_MARKER_MODES.join(' | ')}, default ${DEFAULT_REPLY_MARKER}) and where the value comes from`,
  args: [],
  options: {},
  run: async (context): Promise<CommandOutput> => {
    const setting = await guarded(() => readReplyMarker(context.configDir));
    const from = setting.source === 'config.yml' ? setting.file : `default (${setting.file} does not set replyMarker)`;
    return {
      json: { mode: setting.mode, source: setting.source, file: setting.file, modes: REPLY_MARKER_MODES, defaultMode: DEFAULT_REPLY_MARKER },
      lines: [`Reply marker: ${setting.mode} (${EXAMPLE[setting.mode]})`, `From: ${from}`, `Change it: 'agent-manager reply-marker set <${REPLY_MARKER_MODES.join('|')}>'`, ...NOTES],
    };
  },
};

const setCommand: Command = {
  name: 'reply-marker set',
  summary: `Set the marker line replies start with: ${REPLY_MARKER_MODES.join(' | ')}. Writes replyMarker in config.yml (the next reply uses it); nothing is sent`,
  args: ['mode'],
  options: {},
  run: async (context, args): Promise<CommandOutput> => {
    const setting = await guarded(() => setReplyMarker(context.configDir, args[0]!));
    return {
      json: { ok: true, mode: setting.mode, file: setting.file },
      lines: [`Reply marker is now ${setting.mode} (${EXAMPLE[setting.mode]}). Written in ${setting.file}`, ...NOTES],
    };
  },
};

export const REPLY_MARKER_COMMANDS: Command[] = [showCommand, setCommand];
