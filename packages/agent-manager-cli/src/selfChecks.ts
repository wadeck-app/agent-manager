import { getErrorMessage } from './errors.js';
import type { SelfCheckResult } from '@wadeck-app/shared-cli';
import { parseDuration } from './duration.js';
import { currentVersion } from './version.js';

type Check = () => Promise<SelfCheckResult>;

/** Runs `body`; any error becomes a failed result carrying the reason, never an escaped exception. */
function check(name: string, body: () => void | Promise<void>): Check {
  return async () => {
    try {
      await body();
      return { name, ok: true };
    } catch (error) {
      return { name, ok: false, detail: getErrorMessage(error) };
    }
  };
}

/** The checks `agent-manager cli self-check` runs; the updater runs them on the freshly installed version before keeping it. */
export function selfChecks(): Check[] {
  return [
    check('Version', () => {
      if (currentVersion() === '') {
        throw new Error('the version of the bundle is empty');
      }
    }),
    check('Duration parser', () => {
      const parsed = parseDuration('1h5m30s');
      if (parsed !== 3_930_000) {
        throw new Error(`parseDuration('1h5m30s') returned ${parsed}, expected 3930000`);
      }
    }),
  ];
}
