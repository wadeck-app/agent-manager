import { clockText, remainingText, type CliGrantDto, type GrantDto } from '../deps.js';

/** What every look of a bypass row shows, whichever source it comes from (the admin CLI for this session, the plugin files for the others). */
export interface GrantRowData {
  id: string;
  category: string;
  /** Epoch ms of the expiry. */
  expiresAt: number;
  /** "1 use left", "0 of 1 uses"; EMPTY when the bypass has no use limit (nothing to say then). */
  usesText: string;
  /** The reason given for the bypass; empty when none was given. */
  reason: string;
  /** The session that holds the bypass, by its registry name (or the first 8 characters of its id); empty for a bypass of the open session. */
  sessionLabel: string;
  sessionId: string;
  /** Where the bypass was made ('ui' reads "added from this page"); empty when the plugin gives none. */
  origin: string;
  /** Set when this bypass can be revoked from here (listed by the admin CLI): the PIN-gated revoke takes this object. */
  cli: CliGrantDto | undefined;
}

export const NO_REASON = 'No reason given';

export function fromCli(grant: CliGrantDto): GrantRowData {
  return {
    id: grant.id,
    category: grant.category,
    expiresAt: grant.expiresAt,
    usesText: grant.usesLeft === null ? '' : `${grant.usesLeft} use${grant.usesLeft === 1 ? '' : 's'} left`,
    reason: grant.reason,
    sessionLabel: '',
    sessionId: grant.sessionId,
    origin: grant.origin ?? '',
    cli: grant,
  };
}

export function fromFile(grant: GrantDto, showSession: boolean): GrantRowData {
  return {
    id: grant.id,
    category: grant.category,
    expiresAt: grant.expiresAt,
    usesText: grant.maxUses === null ? '' : `${grant.used} of ${grant.maxUses} use${grant.maxUses === 1 ? '' : 's'}`,
    reason: grant.rationale,
    sessionLabel: showSession ? (grant.sessionName === '' ? grant.sessionId.slice(0, 8) : grant.sessionName) : '',
    sessionId: grant.sessionId,
    origin: '',
    cli: undefined,
  };
}

/** The time left of a bypass at `now`: "37 min left", or "expired". */
export function leftOf(grant: GrantRowData, now: number): { expired: boolean; text: string; soon: boolean } {
  const left = Math.max(0, grant.expiresAt - now);
  return { expired: left === 0, text: left === 0 ? 'expired' : `${remainingText(left)} left`, soon: left > 0 && left < 5 * 60_000 };
}

/** The lines of the tooltip of a row: everything the row itself does not say (full reason, id, expiry, origin). */
export function detailRows(grant: GrantRowData): { label: string; value: string; clamp?: 1 | 2 | 3 | 4 }[] {
  const rows: { label: string; value: string; clamp?: 1 | 2 | 3 | 4 }[] = [
    { label: 'Reason', value: grant.reason === '' ? NO_REASON : grant.reason, clamp: 4 },
    { label: 'Expires', value: clockText(grant.expiresAt) },
    { label: 'Bypass id', value: grant.id },
    { label: 'Session id', value: grant.sessionId },
  ];
  if (grant.usesText !== '') {
    rows.splice(1, 0, { label: 'Uses', value: grant.usesText });
  }
  if (grant.sessionLabel !== '') {
    rows.splice(1, 0, { label: 'Session', value: grant.sessionLabel });
  }
  if (grant.origin !== '') {
    rows.push({ label: 'Origin', value: grant.origin === 'ui' ? 'Added from this page, with your PIN' : grant.origin });
  }
  return rows;
}

/** One row of the list: one bypass, or (look "Grouped") several that share session, reason and expiry minute. */
export interface GrantGroup {
  key: string;
  grants: GrantRowData[];
}

export function singles(grants: readonly GrantRowData[]): GrantGroup[] {
  return grants.map((grant) => ({ key: `${grant.sessionId}|${grant.id}`, grants: [grant] }));
}

/** Bypasses of the same session with the same reason and the same expiry minute (made by one request, git-commit and git-push for instance) fold into one group; the order of the list is kept. */
export function groupByReason(grants: readonly GrantRowData[]): GrantGroup[] {
  const groups = new Map<string, GrantGroup>();
  for (const grant of grants) {
    const key = `${grant.sessionId}|${grant.reason}|${Math.floor(grant.expiresAt / 60_000)}`;
    const found = groups.get(key);
    if (found === undefined) {
      groups.set(key, { key, grants: [grant] });
    } else {
      found.grants.push(grant);
    }
  }
  return [...groups.values()];
}
