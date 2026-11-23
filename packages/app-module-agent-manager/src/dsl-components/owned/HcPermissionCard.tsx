import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { failureText, requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { isBgOwned, isWebOwned } from '../logic/owned.js';
import type { HcPermissionDecisionResponse, HcPermissionPromptDto } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { HcPermissionPrompt } from './HcPermissionPrompt.js';
import { useHcPermission } from './useHcPermission.js';

/** How long the answer of the last decision stays on screen. */
export const HC_FEEDBACK_MS = 8000;

/** The sessions the card is for: alive, waiting (the registry says `waiting`: state needs-you), and not a Web session (those have PermissionCard) nor a Background one (the header says: answer in claude attach). */
export function wantsHcCard(session: Pick<AgentRow, 'alive' | 'state' | 'launchedBy' | 'host'>): boolean {
  return session.alive && session.state === 'needs-you' && !isWebOwned(session) && !isBgOwned(session);
}

/**
 * The permission dialog of a session that waits and runs in a herdr-core terminal (an X3 owned session, or a discovered one started in such a terminal),
 * above the reply box. Allow once types Enter into the terminal, Deny types Esc: the card says so in its header. The decision carries the id of the dialog
 * that was displayed: a changed dialog is refused (409) and the card shows the new one. No key answers it: both buttons need a click.
 * A session that waits but cannot be answered from here (no herdr-core terminal, hc missing, a dialog that is not a tool permission) says why, with the fix.
 */
export function HcPermissionCard({ session }: { session: AgentRow }) {
  const enabled = wantsHcCard(session);
  const { answer, error, errorCode, refresh } = useHcPermission(session.sessionId, enabled);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [inFlight, setInFlight] = useState(false);
  const [failure, setFailure] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; warn: boolean } | undefined>(undefined);

  useEffect(() => {
    if (feedback === undefined) {
      return;
    }
    const timer = setTimeout(() => setFeedback(undefined), HC_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  const decide = async (prompt: HcPermissionPromptDto, decision: 'allow' | 'deny'): Promise<void> => {
    setInFlight(true);
    setFailure('');
    setFeedback(undefined);
    const result = await requestJson<HcPermissionDecisionResponse>(`/sessions/${encodeURIComponent(session.sessionId)}/hc-permission`, { method: 'POST', body: { decision, promptId: prompt.promptId } });
    setInFlight(false);
    const what = prompt.tool ?? prompt.header;
    if (!result.ok || !result.value.ok) {
      // The server's text says whether anything was typed (it does for each refusal): never claimed here. The dialog is read again, so the card shows what is true now.
      setFailure(`The ${what} request was not ${decision === 'allow' ? 'allowed' : 'denied'} from this page. ${result.ok ? failureText(result.value, 200) : result.text}`);
      refresh();
      return;
    }
    setAnswered((previous) => new Set(previous).add(prompt.promptId));
    const typed = `${result.value.keys.join(' ')} was typed into ${result.value.terminal}`;
    setFeedback(
      result.value.effect === 'unknown'
        ? { text: `${typed}, or may have been: ${result.value.note}`, warn: true }
        : result.value.effect === 'closed'
        ? { text: decision === 'allow' ? `Allowed ${what} once (${typed}). The terminal is now ${result.value.statusAfter}.` : `Denied ${what} (${typed}). The terminal is now ${result.value.statusAfter}.`, warn: false }
        : { text: `${typed}, but the dialog is still displayed after a few seconds. Look at the terminal ${result.value.terminal} before answering again.`, warn: true },
    );
    refresh();
  };

  if (!enabled) {
    return null;
  }
  const prompt = answer?.state === 'prompt' && !answered.has(answer.prompt.promptId) ? answer.prompt : undefined;
  const unsupported = answer?.state === 'unsupported' ? answer : undefined;
  if (prompt === undefined && unsupported === undefined && error === '' && failure === '' && feedback === undefined) {
    return null;
  }
  return (
    <section aria-label="Permission request in the terminal" data-hc-permission-card="" className={`flex shrink-0 flex-col gap-1.5 border-t px-4 py-2 ${prompt === undefined ? 'border-border bg-surface' : 'border-hue-red bg-hue-red-bg'}`}>
      {error !== '' ? (
        <Banner tone={errorCode === 'request-failed' ? 'error' : 'info'}>
          {`This session waits for a permission, and it cannot be answered from this page: ${error}`}
        </Banner>
      ) : null}
      {unsupported !== undefined ? <Banner tone="warning">{`${unsupported.reason}. ${unsupported.fix}`}</Banner> : null}
      {failure !== '' ? <Banner tone="error">{failure}</Banner> : null}
      {feedback !== undefined ? (
        feedback.warn ? (
          <Banner tone="warning">{feedback.text}</Banner>
        ) : (
          <p role="status" className="flex items-center gap-1.5 text-sm text-content">
            <Check aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-hue-green" />
            {feedback.text}
          </p>
        )
      ) : null}
      {prompt !== undefined ? <HcPermissionPrompt key={prompt.promptId} prompt={prompt} inFlight={inFlight} onDecide={(decision) => void decide(prompt, decision)} /> : null}
    </section>
  );
}
