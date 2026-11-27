import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { GUARDRAILS_REVOKE_ENABLED, type CliGrantDto } from '../deps.js';
import { leftOf, type GrantRowData } from './grantModel.js';

/** What a bypass row receives: one bypass, the clock, and the revoke of the panel. */
export interface GrantRowProps {
  grant: GrantRowData;
  now: number;
  busy: boolean;
  /** The PIN-gated revoke of this bypass (true when it went through). */
  onRevoke: (grant: CliGrantDto) => Promise<boolean>;
}

const CONFIRM_BOX = 'flex flex-col gap-1.5 rounded border border-warning bg-warning-bg px-2 py-1.5 text-xs text-warning-text';

/** The revoke of a row: the icon that asks and the box that confirms. Nothing is sent before "Confirm revoke" (then the PIN dialog of the shell). */
export function useGrantRevoke({ grant, now, busy, onRevoke }: GrantRowProps): { icon: ReactNode; confirmBox: ReactNode } {
  const [confirming, setConfirming] = useState(false);
  const revocable = GUARDRAILS_REVOKE_ENABLED && grant.cli !== undefined;
  const expired = leftOf(grant, now).expired;
  const subject = `the ${grant.category} bypass`;
  const run = async (): Promise<void> => {
    setConfirming(false);
    if (grant.cli !== undefined) {
      await onRevoke(grant.cli);
    }
  };
  const icon =
    revocable && !confirming ? (
      <IconButton
        size="icon-sm"
        disabled={expired || busy}
        icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
        aria-label={`Revoke ${subject}`}
        tooltip={`Revoke ${subject}. You confirm first, then your PIN is asked.`}
        onClick={() => setConfirming(true)}
      />
    ) : null;
  const confirmBox = confirming ? (
    <div className={CONFIRM_BOX}>
      <p>{`Revoke ${subject} (${leftOf(grant, now).text})? The guardrail applies again to this session at once.`}</p>
      <div className="flex gap-1.5">
        <ButtonAction variant="danger" size="sm" disabled={expired || busy} label="Confirm revoke" onClick={() => void run()} />
        <ButtonAction variant="secondary" size="sm" label="Cancel" onClick={() => setConfirming(false)} />
      </div>
    </div>
  ) : null;
  return { icon, confirmBox };
}

/** The category of a bypass (a title). */
export const GRANT_TITLE = 'min-w-0 truncate text-xs font-medium text-content';
