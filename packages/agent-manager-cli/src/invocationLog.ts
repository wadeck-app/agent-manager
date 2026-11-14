import { getErrorMessage } from './errors.js';
import { logCliInvocation } from '@wadeck-app/shared-cli/CliLogger';
import { appendLog } from '@wadeck-app/shared-updater';

/** What one invocation of the CLI writes to <config folder>/logs/YYYY-MM-DD.ndjson, the file the updater writes to as well. */
export interface InvocationLog {
  /** How the invocation ended; a non-zero exit code is logged at error level, with the code of the error when it has one. */
  outcome: (exitCode: number, errorCode?: string) => void;
}

/** `https://user:token@host` becomes `https://***@host`: arguments such as a URL may carry credentials. */
function redact(arg: string): string {
  return arg.replace(/(\w+:\/\/)[^\s/@]+@/g, '$1***@');
}

/**
 * Logs the invocation and returns the writer of the following entries. A log that cannot be written never blocks
 * the command, but it is not silent either: `warn` is called once, with the reason.
 */
export function openInvocationLog(configDir: string, argv: readonly string[], warn: (reason: string) => void): InvocationLog {
  let warned = false;
  const guarded = (write: () => void): void => {
    try {
      write();
    } catch (error) {
      if (!warned) {
        warned = true;
        warn(getErrorMessage(error));
      }
    }
  };

  guarded(() => logCliInvocation(configDir, 'agent-manager', argv.map(redact)));
  return {
    outcome: (exitCode, errorCode) =>
      guarded(() => appendLog(configDir, exitCode === 0 ? 'info' : 'error', `exit ${exitCode}${errorCode === undefined ? '' : ` (${errorCode})`}`)),
  };
}
