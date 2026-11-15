import { TriangleAlert, UserCog } from 'lucide-react';
import { Tooltip } from '../deps.js';
import { CHIP, CHIP_ICON } from './chipStyle.js';

const ERROR_PREFIX = '!role-err:';

/** The role of the session (the file the role skills write). A broken role file ('!role-err:<cause>') is shown as an error with its cause, never as a role. */
export function RoleChip({ role }: { role: string }) {
  if (role.startsWith(ERROR_PREFIX)) {
    const cause = role.slice(ERROR_PREFIX.length).trim();
    return (
      <Tooltip content={`The role file of this session is broken: ${cause === '' ? 'no cause given' : cause}. Fix or recreate it with the role skill.`}>
        <span tabIndex={0} aria-label={`Role error: ${cause}`} className="inline-flex items-center gap-1 rounded border border-danger bg-danger-bg px-1.5 py-0.5 text-xs text-danger-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <TriangleAlert aria-hidden="true" className={CHIP_ICON} />
          Role error
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="The role of this session (from its role file).">
      <span tabIndex={0} aria-label={`Role ${role}`} className={CHIP}>
        <UserCog aria-hidden="true" className={CHIP_ICON} />
        {role}
      </span>
    </Tooltip>
  );
}
