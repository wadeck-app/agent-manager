import { CopyButton } from '../detail/log/CopyButton.js';
import { Banner } from '../ui/Banner.js';

const DAEMON_COMMAND = 'rounded border border-border bg-surface px-2 py-1 font-mono text-am-mono text-content';

/** The command that starts the daemon, shown (with a copy button) when the daemon is not running. */
export const DAEMON_START_COMMAND = 'agent-manager start --detach';

/** The fix of a daemon that is not running: the command, ready to copy. */
export function DaemonNotRunning({ what = 'launch a session', enables = 'Launch' }: { what?: string; enables?: string }) {
  return (
    <Banner tone="warning">
      <p className="font-medium">{`The agent-manager daemon is not running, so you cannot ${what} from here.`}</p>
      <p className="mt-1">{`Start it in a terminal, then come back: this page notices within 5 seconds and enables ${enables}.`}</p>
      <div className="mt-2 flex items-center gap-2">
        <code data-daemon-command="" className={DAEMON_COMMAND}>
          {DAEMON_START_COMMAND}
        </code>
        <CopyButton text={DAEMON_START_COMMAND} label="Copy the command" />
      </div>
    </Banner>
  );
}
