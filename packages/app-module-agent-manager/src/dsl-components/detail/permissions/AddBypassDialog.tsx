import { ButtonAction, FieldSelect, FieldText, TabButton } from '@wadeck-app/dsl-ui';
import { LoaderCircle, ShieldPlus } from 'lucide-react';
import { useState } from 'react';
import { addableCategories, Banner, categoryOptions, confirmLine, DialogActions, failureText, MODE_CHOICES, Modal, rationaleProblem, requestJson, Tooltip, type AgentRow, type GrantAddedDto, type GrantModeDto } from '../deps.js';
import type { RulesState } from './useSessionRules.js';

export interface AddBypassDialogProps {
  session: AgentRow;
  /** The folder the plugin will be asked about (the one the list reported, else the session's). */
  folder: string;
  rules: RulesState;
  onClose: () => void;
  /** The bypass was made: its answer (the panel shows it and reloads the list). */
  onAdded: (added: GrantAddedDto) => void;
}

/**
 * Add a bypass for this session (threat-model T-23): the category (only the ones a bypass can lift, each with what the guardrail does now), the duration, a reason
 * for the plugin journal, and the sentence that is confirmed. The route is PIN-gated: the shell asks for the PIN when the button is pressed. A refusal keeps the
 * dialog open with the server's words and the choices as they were, so a retry is one click.
 */
export function AddBypassDialog({ session, folder, rules, onClose, onAdded }: AddBypassDialogProps) {
  const categories = rules.kind === 'ok' ? addableCategories(rules.data.categories) : [];
  // The category that blocked this session the most is the likely one; else the first the plugin lists.
  const blocked = session.guardrailBlocks?.categories.find((item) => categories.some((rule) => rule.name === item.category))?.category;
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<GrantModeDto>('once');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const category = chosen ?? blocked ?? categories[0]?.name ?? '';
  const problem = reason === '' ? '' : rationaleProblem(reason);
  const ready = rules.kind === 'ok' && category !== '' && rationaleProblem(reason) === '';
  const sessionName = session.displayName;

  const submit = async (): Promise<void> => {
    if (!ready || busy) {
      return;
    }
    setBusy(true);
    setError('');
    const result = await requestJson<GrantAddedDto | { ok: false; error: { message: string; hint: string } }>(`/guardrails/sessions/${encodeURIComponent(session.sessionId)}/grants`, { method: 'POST', body: { category, mode, rationale: reason.trim() } });
    setBusy(false);
    if (!result.ok) {
      setError(result.text);
      return;
    }
    if (!result.value.ok) {
      setError(failureText(result.value, 200));
      return;
    }
    onAdded(result.value);
  };

  return (
    <Modal title="Add a bypass" onClose={onClose} dismissible={!busy} size="narrow">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-content">Lift one guardrail for this session only. You are asked for your PIN when you confirm.</p>
        {rules.kind === 'loading' ? <p role="status" className="text-sm text-muted">Reading the categories from the plugin...</p> : null}
        {rules.kind === 'error' ? <Banner tone="error">{`The categories could not be read from the plugin: ${rules.text}`}</Banner> : null}
        {rules.kind === 'ok' && categories.length === 0 ? <Banner tone="warning">The plugin lists no category that a bypass can lift for this folder.</Banner> : null}
        <FieldSelect label="Category" value={category} onChange={setChosen} options={categoryOptions(categories)} disabled={busy || categories.length === 0} />
        <div role="group" aria-label="Duration" className="flex flex-wrap items-center gap-1.5">
          {MODE_CHOICES.map((choice) => (
            <Tooltip key={choice.value} content={choice.meaning}>
              {/* The chosen duration is a filled button: the base tab underline alone is too faint to tell which one is on. */}
              <TabButton size="sm" type="button" variant={mode === choice.value ? 'primary' : 'ghost'} active={mode === choice.value} aria-pressed={mode === choice.value} disabled={busy} onClick={() => setMode(choice.value)}>
                {choice.label}
              </TabButton>
            </Tooltip>
          ))}
        </div>
        <FieldText label="Reason" value={reason} onChange={setReason} disabled={busy} autoComplete="off" required error={problem} description="It is stored as plain text and shown in the plugin journal." />
        {category === '' ? null : <p className="text-sm font-medium text-content">{confirmLine(category, mode, sessionName, folder)}</p>}
        {error === '' ? null : <Banner tone="error">{error}</Banner>}
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm animate-spin motion-reduce:animate-none" />
            Waiting for the PIN and the plugin...
          </p>
        ) : null}
        <DialogActions>
          <ButtonAction variant="secondary" label="Cancel" onClick={onClose} disabled={busy} />
          <ButtonAction variant="primary" type="submit" icon={<ShieldPlus aria-hidden="true" className="h-4 w-4" />} label="Add bypass" disabled={!ready || busy} />
        </DialogActions>
      </form>
    </Modal>
  );
}
