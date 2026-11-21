import type { Session } from '../session.js';
import { ReplyError } from './errors.js';
import { asRecord, asText, excerpt, failureOf, parseJson } from './hcRunner.js';
import type { HcRunner } from './hcRunner.js';

/*
 * The mapping session -> herdr-core terminal, shared by the hc reply transport (hcTransport.ts) and the hc approval (HcApproval.ts): the registry pid of
 * the session equals `foreground.pid` of exactly one `hc get` (measured on 2 of 2 claude terminals, then on the terminals started by HcLauncher).
 * No terminal, or two: unavailable, never a guess. Not implemented: matching through the process tree (a claude that is not the foreground program of
 * its terminal is reported unavailable), other machines (`machine/t7`).
 */

/** How long one list of terminals is reused by probes (a send re-reads its one terminal fresh, so a stale list never types into the wrong place). */
export const DEFAULT_SNAPSHOT_TTL_MS = 15_000;
export const DEFAULT_QUERY_TIMEOUT_MS = 10_000;
const LIST_CONCURRENCY = 4;

export interface TerminalFacts {
  address: string;
  /** `foreground.pid`: the program that has the terminal now (claude.exe for a Claude Code terminal). */
  foregroundPid: number | undefined;
  /** `status.state`: idle, working, done, blocked or error; undefined when the program reports none. */
  statusState: string | undefined;
  /** `status.kind` of a blocked terminal: permission, question or auth. */
  statusKind: string | undefined;
  /** `status.msg`: what the program says about the status (`approve Bash: touch x`, `trust this folder`). */
  statusMessage: string | undefined;
  /** `status_ms`: epoch ms at which hc saw the status last change (a new dialog gets a new value). */
  statusSinceMs: number | undefined;
  /** `turn`: the turn counter of the terminal. */
  turn: number | undefined;
  /** `cols`: the width of the terminal (the rules of a dialog are exactly this wide). */
  columns: number | undefined;
}

export type Resolved =
  | { ok: true; terminal: TerminalFacts; examined: number }
  | { ok: false; code: string; reason: string; fix: string; examined: number };

export interface HcTerminalsOptions {
  runner: HcRunner;
  queryTimeoutMs?: number;
  snapshotTtlMs?: number;
  clock?: () => number;
}

export interface HcTerminals {
  /** Runs a read-only hc query; returns its JSON, or throws the ReplyError that says why hc could not answer. */
  query(args: readonly string[], what: string): Promise<unknown>;
  getTerminal(address: string): Promise<TerminalFacts>;
  /** The terminal of a session from a list that may be up to snapshotTtlMs old (probes), or from a fresh one. */
  resolveTerminal(session: Session, fresh: boolean): Promise<Resolved>;
  /** The terminal of a session read now: the one the last probe matched is re-read alone, else all terminals are listed. Throws the ReplyError of a failed match. */
  freshTerminal(session: Session): Promise<TerminalFacts>;
  /**
   * Like freshTerminal, but a session whose terminal was NOT found is not searched for again before the snapshot is older than snapshotTtlMs: for a poll
   * (a session that has no herdr-core terminal must not cost one hc call per terminal every 2 s). The terminal it returns is always read now.
   */
  polledTerminal(session: Session): Promise<TerminalFacts>;
}

export function createHcTerminals(options: HcTerminalsOptions): HcTerminals {
  const { runner } = options;
  const queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const snapshotTtlMs = options.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS;
  const clock = options.clock ?? Date.now;

  async function query(args: readonly string[], what: string): Promise<unknown> {
    const run = await runner.run(args, queryTimeoutMs, what);
    const failure = failureOf(run);
    if (run.code !== 0 || failure !== undefined) {
      const reason = failure === undefined ? `hc ${args.join(' ')} failed (exit ${String(run.code)}): ${excerpt(run.stderr || run.stdout) || 'no output'}` : `hc says ${failure.kind}: ${failure.message}`;
      throw new ReplyError(failure?.kind === 'not_found' ? 'terminal-gone' : 'hc-query-failed', reason, failure?.hint !== undefined && failure.hint !== '' ? `${failure.hint}; check that herdr-core runs (hc server status)` : 'check that herdr-core runs (hc server status), then retry');
    }
    const value = parseJson(run.stdout.trim());
    if (value === undefined) {
      throw new ReplyError('hc-bad-answer', `hc ${args.join(' ')} did not print JSON (${excerpt(run.stdout) || 'no output'})`, 'report this: the hc output format changed (tested with hc 0.1.21)');
    }
    return value;
  }

  function factsOf(value: unknown, address: string): TerminalFacts {
    const record = asRecord(value);
    const foreground = asRecord(record?.['foreground']);
    const status = asRecord(record?.['status']);
    const pid = foreground?.['pid'];
    return {
      address,
      foregroundPid: typeof pid === 'number' ? pid : undefined,
      statusState: asText(status?.['state']),
      statusKind: asText(status?.['kind']),
      statusMessage: asText(status?.['msg']),
      statusSinceMs: typeof record?.['status_ms'] === 'number' ? record['status_ms'] : undefined,
      turn: typeof record?.['turn'] === 'number' ? record['turn'] : undefined,
      columns: typeof record?.['cols'] === 'number' ? record['cols'] : undefined,
    };
  }

  async function getTerminal(address: string): Promise<TerminalFacts> {
    return factsOf(await query(['get', '--json', '--', address], `get ${address}`), address);
  }

  // One snapshot of the claude terminals at a time, shared by concurrent probes.
  let snapshot: { at: number; promise: Promise<{ terminals: TerminalFacts[]; examined: number }> } | undefined;

  async function takeSnapshot(): Promise<{ terminals: TerminalFacts[]; examined: number }> {
    const list = asRecord(await query(['ls', '--json'], 'ls'));
    const rows = Array.isArray(list?.['terminals']) ? (list['terminals'] as unknown[]) : undefined;
    if (rows === undefined) {
      throw new ReplyError('hc-bad-answer', 'hc ls --json has no "terminals" list', 'report this: the hc output format changed (tested with hc 0.1.21)');
    }
    // Only the terminals that run Claude Code can hold the session; the others are not asked (one hc call per terminal).
    const addresses = rows
      .map(asRecord)
      .filter((row) => row !== undefined && row['state'] === 'live' && row['agent'] === 'claude-code')
      .map((row) => asText(row?.['address']))
      .filter((address): address is string => address !== undefined);
    const terminals: TerminalFacts[] = [];
    for (let index = 0; index < addresses.length; index += LIST_CONCURRENCY) {
      const batch = addresses.slice(index, index + LIST_CONCURRENCY);
      const facts = await Promise.all(
        batch.map(async (address) => {
          try {
            return await getTerminal(address);
          } catch (error) {
            // A terminal that ended between ls and get is not a candidate; any other failure stops the probe (the answer would be a guess).
            if (error instanceof ReplyError && error.code === 'terminal-gone') {
              return undefined;
            }
            throw error;
          }
        }),
      );
      terminals.push(...facts.filter((entry): entry is TerminalFacts => entry !== undefined));
    }
    return { terminals, examined: addresses.length };
  }

  function currentSnapshot(fresh: boolean): Promise<{ terminals: TerminalFacts[]; examined: number }> {
    const now = clock();
    if (fresh || snapshot === undefined || now - snapshot.at > snapshotTtlMs) {
      const promise = takeSnapshot();
      snapshot = { at: now, promise };
      // A failed snapshot is not kept.
      promise.catch(() => {
        if (snapshot?.promise === promise) {
          snapshot = undefined;
        }
      });
    }
    return snapshot!.promise;
  }

  // The terminal the last match found, by session pid: a read re-reads this one terminal instead of listing all of them again.
  const lastMatch = new Map<number, string>();

  async function resolveTerminal(session: Session, fresh: boolean): Promise<Resolved> {
    const { terminals, examined } = await currentSnapshot(fresh);
    const matches = terminals.filter((terminal) => terminal.foregroundPid === session.pid);
    if (matches.length === 1) {
      lastMatch.set(session.pid, matches[0]!.address);
      return { ok: true, terminal: matches[0]!, examined };
    }
    if (matches.length === 0) {
      return {
        ok: false,
        code: 'no-terminal',
        reason: `no herdr-core terminal runs the session process (pid ${session.pid}; ${examined} Claude Code terminal(s) examined): the session was not started in a herdr-core terminal (hc only drives terminals created by herdr-core, it cannot adopt another terminal), or claude is not the foreground program of it`,
        fix: 'start the session with `hc run --bg claude` (a terminal created by herdr-core), or select the socket transport for this session',
        examined,
      };
    }
    return {
      ok: false,
      code: 'ambiguous-terminal',
      reason: `${matches.length} herdr-core terminals (${matches.map((terminal) => terminal.address).join(', ')}) report the same foreground pid ${session.pid}: the target cannot be told apart`,
      fix: 'close the duplicate terminal, or select the socket transport for this session; agent-manager never guesses a terminal',
      examined,
    };
  }

  async function freshTerminal(session: Session): Promise<TerminalFacts> {
    // A user action (a send, a decision) forgets the negative answer of the polls: a terminal started a moment ago is found.
    misses.delete(session.pid);
    const known = lastMatch.get(session.pid);
    if (known !== undefined) {
      try {
        const facts = await getTerminal(known);
        if (facts.foregroundPid === session.pid) {
          return facts;
        }
      } catch (error) {
        if (!(error instanceof ReplyError && error.code === 'terminal-gone')) {
          throw error;
        }
      }
      lastMatch.delete(session.pid);
    }
    const resolved = await resolveTerminal(session, true);
    if (!resolved.ok) {
      throw new ReplyError(resolved.code, resolved.reason, resolved.fix);
    }
    return resolved.terminal;
  }

  // Sessions found to have no matching terminal, by pid: a poll does not look again before snapshotTtlMs has passed (a user action, freshTerminal, always does).
  const misses = new Map<number, { at: number; code: string; reason: string; fix: string }>();

  function remember(session: Session, resolved: Extract<Resolved, { ok: false }>): ReplyError {
    misses.set(session.pid, { at: clock(), code: resolved.code, reason: resolved.reason, fix: resolved.fix });
    return new ReplyError(resolved.code, resolved.reason, resolved.fix);
  }

  async function polledTerminal(session: Session): Promise<TerminalFacts> {
    const known = lastMatch.get(session.pid);
    if (known !== undefined) {
      try {
        const facts = await getTerminal(known);
        if (facts.foregroundPid === session.pid) {
          return facts;
        }
      } catch (error) {
        if (!(error instanceof ReplyError && error.code === 'terminal-gone')) {
          throw error;
        }
      }
      // The remembered terminal is gone or belongs to another process: one full listing now, and its answer (found or not) is cached like any other.
      lastMatch.delete(session.pid);
      const resolved = await resolveTerminal(session, true);
      if (!resolved.ok) {
        throw remember(session, resolved);
      }
      misses.delete(session.pid);
      return resolved.terminal;
    }
    const miss = misses.get(session.pid);
    if (miss !== undefined && clock() - miss.at <= snapshotTtlMs) {
      throw new ReplyError(miss.code, miss.reason, miss.fix);
    }
    const resolved = await resolveTerminal(session, false);
    if (!resolved.ok) {
      throw remember(session, resolved);
    }
    misses.delete(session.pid);
    return freshTerminal(session);
  }

  return { query, getTerminal, resolveTerminal, freshTerminal, polledTerminal };
}
