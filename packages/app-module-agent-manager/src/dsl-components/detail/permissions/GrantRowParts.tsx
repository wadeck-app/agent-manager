import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { GUARDRAILS_REVOKE_ENABLED, type CliGrantDto } from '../deps.js';
import { leftOf, type GrantGroup, type GrantRowData } from './grantModel.js';

/** What every look of a bypass row receives: one row of the list (a group of one, but for the look "Grouped"), the clock, and the revoke of the panel. */
export interface GrantRowProps {
  group: GrantGroup;
  now: number;
  busy: boolean;
  /** The PIN-gated revoke of one bypass (true when it went through); a group is revoked one bypass after the other, the first failure stops it. */
  onRevoke: (grant: CliGrantDto) => Promise<boolean>;
}

const CONFIRM_BOX = 'flex flex-col gap-1.5 rounded border border-warning bg-warning-bg px-2 py-1.5 text-xs text-warning-text';

/** The colours of the left rule of a category, in full (a class built at run time generates no CSS rule). */
const RULES = ['border-l-hue-red', 'border-l-hue-orange', 'border-l-hue-yellow', 'border-l-hue-green', 'border-l-hue-cyan', 'border-l-hue-blue', 'border-l-hue-purple'] as const;

/** The same category always gets the same colour. */
export function ruleOf(category: string): string {
  let sum = 0;
  for (const char of category) {
    sum += char.charCodeAt(0);
  }
  return RULES[sum % RULES.length]!;
}

/** "git-commit", or "git-commit and git-push" for a group. */
export function categoriesText(grants: readonly GrantRowData[]): string {
  const names = grants.map((grant) => grant.category);
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The revoke of a row: the icon that asks and the box that confirms. Nothing is sent before "Confirm revoke" (then the PIN dialog of the shell). */
export function useGrantRevoke({ group, now, busy, onRevoke }: GrantRowProps): { icon: ReactNode; confirmBox: ReactNode } {
  const [confirming, setConfirming] = useState(false);
  const grants = group.grants;
  const revocable = GUARDRAILS_REVOKE_ENABLED && grants.every((grant) => grant.cli !== undefined);
  const expired = grants.some((grant) => leftOf(grant, now).expired);
  const subject = grants.length === 1 ? `the ${grants[0]!.category} bypass` : `the ${grants.length} bypasses: ${categoriesText(grants)}`;
  const run = async (): Promise<void> => {
    setConfirming(false);
    for (const grant of grants) {
      if (grant.cli === undefined || !(await onRevoke(grant.cli))) {
        return;
      }
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
      <p>{`Revoke ${subject} (${leftOf(grants[0]!, now).text})? The guardrail applies again to this session at once.`}</p>
      <div className="flex gap-1.5">
        <ButtonAction variant="danger" size="sm" disabled={expired || busy} label="Confirm revoke" onClick={() => void run()} />
        <ButtonAction variant="secondary" size="sm" label="Cancel" onClick={() => setConfirming(false)} />
      </div>
    </div>
  ) : null;
  return { icon, confirmBox };
}

/** The classes shared by the looks: the category (a title that gives way to the chips) and the session name of a bypass of another session. */
export const GRANT_TITLE = 'min-w-0 truncate text-xs font-medium text-content';
export const GRANT_SESSION = 'min-w-0 max-w-[45%] shrink-0 truncate text-xs font-medium text-muted';
