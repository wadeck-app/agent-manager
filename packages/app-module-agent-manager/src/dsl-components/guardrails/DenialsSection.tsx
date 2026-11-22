import { History, Lock, LockOpen, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { DenialRow } from './DenialRow.js';
import { Banner } from '../ui/Banner.js';
import { CompactSelect, IconButton, TabButton } from '@wadeck-app/dsl-ui';
import { Empty } from './Empty.js';
import { FIELD, MONO, TH } from './parts.js';
import { Section } from './Section.js';
import { ScrollTable } from '../ui/ScrollTable.js';
import { useDenials, type DenialFilter } from './useGuardrails.js';

const LIMITS = [50, 100, 250, 500];
const SESSION_OK = /^[0-9a-f]{0,8}$/i;

/**
 * The newest denials and asks of the plugin's journal (all projects), with filters. The tail of the journal only, newest first, in a bounded read. Command
 * texts come from a PIN-protected route and are asked for on purpose ("Show commands"): they are not masked.
 */
export function DenialsSection() {
  const [filter, setFilter] = useState<DenialFilter>({ day: '', category: '', session: '', limit: 100 });
  const [wantCommands, setWantCommands] = useState(false);
  const loaded = useDenials(filter, wantCommands);
  const value = loaded.value;
  // A chosen day stays in the list even when a refresh does not return it.
  const dayChoices = [...new Set([...(value?.days ?? []), ...(filter.day === '' ? [] : [filter.day])])].sort().reverse();
  const set = (patch: Partial<DenialFilter>): void => setFilter((previous) => ({ ...previous, ...patch }));
  return (
    <Section
      id="guardrails-denials"
      icon={History}
      title="Recent denials"
      count={value?.denials.length}
      actions={
        <>
<TabButton
            size="sm"
            variant={wantCommands && loaded.commandsError === '' ? 'danger-outline' : 'ghost'}
            active={wantCommands && loaded.commandsError === ''}
            aria-pressed={wantCommands && loaded.commandsError === ''}
            onClick={() => setWantCommands((previous) => !previous)}
          >
            {wantCommands && loaded.commandsError === '' ? <LockOpen aria-hidden="true" className="h-3.5 w-3.5" /> : <Lock aria-hidden="true" className="h-3.5 w-3.5" />}
            Show commands (PIN)
          </TabButton>
          <IconButton icon={<RefreshCw aria-hidden="true" className="h-4 w-4" />} aria-label="Refresh the timeline" onClick={loaded.reload} disabled={loaded.loading} disabledReason={loaded.loading ? 'loading' : undefined} />
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-3 border-b border-border px-3 py-2">
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          Day
<CompactSelect ariaLabel="Day" value={filter.day} onChange={(day) => set({ day })} options={[{ value: '', label: 'Newest days' }, ...dayChoices.map((day) => ({ value: day, label: day }))]} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          Category
<CompactSelect
            ariaLabel="Category"
            value={filter.category}
            onChange={(category) => set({ category })}
            options={[{ value: '', label: 'All categories' }, ...[...new Set([...(value?.categories ?? []), ...(filter.category === '' ? [] : [filter.category])])].sort().map((category) => ({ value: category, label: category }))]}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          Session (first characters of its id)
          <input
            aria-label="Session prefix"
            value={filter.session}
            placeholder="287760ca"
            maxLength={8}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => SESSION_OK.test(event.target.value) && set({ session: event.target.value.toLowerCase() })}
            className={`${FIELD} w-32 ${MONO}`}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          Show
<CompactSelect ariaLabel="Number of denials" value={String(filter.limit)} onChange={(limit) => set({ limit: Number(limit) })} options={LIMITS.map((limit) => ({ value: String(limit), label: `${limit} newest` }))} />
        </label>
      </div>
      <div className="flex flex-col gap-2 px-3 pt-3">
        {loaded.error !== '' ? <Banner tone="error">{loaded.error}</Banner> : null}
        {loaded.commandsError !== '' ? <Banner tone="warning">The command texts are not shown: {loaded.commandsError}</Banner> : null}
        {value?.problems.map((item) => (
          <Banner key={`${item.file}|${item.message}`} tone="warning">
            {item.file} {item.message}. {item.hint}
          </Banner>
        ))}
        {value !== undefined && value.withCommands ? <Banner tone="warning">{value.note}</Banner> : null}
      </div>
      {value === undefined && loaded.error === '' ? (
        <div role="status" aria-busy="true" className="p-3 text-sm text-muted">
          Loading the journal tail...
        </div>
      ) : null}
      {value !== undefined && value.denials.length === 0 ? <Empty title="No denial matches" hint={value.truncated ? 'Older records were not searched (read limit); pick a day to look further back.' : 'The filters match nothing in the journal.'} /> : null}
      {value !== undefined && value.denials.length > 0 ? (
        <ScrollTable label="Recent denials">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Time</th>
              <th className={TH}>Decision</th>
              <th className={TH}>Category</th>
              <th className={TH}>Session</th>
              <th className={TH}>Tool</th>
              <th className={TH}>Project</th>
              <th className={TH}>Command or file</th>
            </tr>
          </thead>
          <tbody>
            {value.denials.map((denial, index) => (
              <DenialRow key={`${denial.at}|${denial.session}|${index}`} denial={denial} withCommands={value.withCommands} />
            ))}
          </tbody>
        </ScrollTable>
      ) : null}
      {value !== undefined ? (
        <p className="border-t border-border px-3 py-2 text-xs text-muted">
          Read {Math.round(value.bytesRead / 1024)} KB from the end of the journal, newest first.{value.truncated ? ' Older records exist that were not read: narrow the filter or pick a day.' : ' Nothing older matches.'}
        </p>
      ) : null}
    </Section>
  );
}
