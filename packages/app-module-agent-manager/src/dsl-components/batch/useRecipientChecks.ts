import { useEffect, useMemo, useState } from 'react';
import { requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import type { ReplyStatusResponse } from '../shared.js';
import { agentId } from '../logic/states.js';
import { eligibilityOf, type Eligibility } from './batchModel.js';

/** Status requests in flight at once: a status probes the selected transport (a terminal for hc), 20 at the same time would be a burst. */
const CHECK_CONCURRENCY = 2;

interface Checked {
  status?: ReplyStatusResponse;
  failure?: string;
}

/**
 * Whether each selected session can receive a message, from the existing GET /sessions/:id/reply/status (the selected transport and its probe), read ONCE
 * when the dialog opens (no polling). A session whose process is gone needs no request. Returns the eligibility by agent id, `checking` until answered.
 */
export function useRecipientChecks(rows: readonly AgentRow[]): ReadonlyMap<string, Eligibility> {
  const [checked, setChecked] = useState<ReadonlyMap<string, Checked>>(new Map());
  // The list of ids is the dependency: a poll that changes other fields of the rows must not ask again.
  const key = rows.map(agentId).join(',');
  useEffect(() => {
    const controller = new AbortController();
    const wanted = rows.filter((row) => row.alive);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < wanted.length && !controller.signal.aborted) {
        const row = wanted[next];
        next += 1;
        if (row === undefined) {
          return;
        }
        const result = await requestJson<ReplyStatusResponse>(`/sessions/${encodeURIComponent(row.sessionId)}/reply/status`, { signal: controller.signal });
        if (controller.signal.aborted) {
          return;
        }
        const entry: Checked = result.ok ? { status: result.value } : { failure: result.text };
        setChecked((current) => new Map(current).set(agentId(row), entry));
      }
    };
    void Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, wanted.length) }, worker));
    return () => controller.abort();
    // `rows` is read through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useMemo(() => {
    const out = new Map<string, Eligibility>();
    for (const row of rows) {
      const entry = checked.get(agentId(row));
      out.set(agentId(row), eligibilityOf(row, entry?.status, entry?.failure));
    }
    return out;
  }, [rows, checked]);
}
