import { Check, Keyboard, LoaderCircle, ShieldAlert, X } from 'lucide-react';
import type { HcPermissionPromptDto } from '../shared.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import { PermissionInput } from './PermissionInput.js';

/** The dialog the terminal shows: what it asks, the command in full (folded when large), the warning that a click types a key, and the two buttons. */
export function HcPermissionPrompt({ prompt, inFlight, onDecide }: { prompt: HcPermissionPromptDto; inFlight: boolean; onDecide: (decision: 'allow' | 'deny') => void }) {
  const title = prompt.tool === undefined ? prompt.header : `${prompt.tool}: ${prompt.header}`;
  return (
    <div data-hc-permission={prompt.promptId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ShieldAlert aria-hidden="true" className="h-am-icon w-am-icon shrink-0 text-hue-red" />
        <h3 className="text-base font-semibold text-content">{`Permission request: ${title}`}</h3>
        <span className="rounded-full bg-surface px-2 text-xs text-muted">{`terminal ${prompt.terminal}`}</span>
      </div>
      {/* The warning of the header: what a click does is a key typed into a real terminal. */}
      <p data-hc-warning="" className="flex items-start gap-1.5 rounded border border-warning bg-warning-bg px-2 py-1.5 text-sm text-warning-text">
        <Keyboard aria-hidden="true" className="mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0" />
        <span>
          This answers the dialog in the terminal by typing the key there: <strong>Allow once</strong> types Enter (option 1, Yes), <strong>Deny</strong> types Esc (cancel). The terminal is not checked again after the key, only before it. &quot;Always allow&quot; is never selected from this page.
        </span>
      </p>
      {prompt.description !== '' ? <p className="text-sm text-content">{prompt.description}</p> : null}
      {prompt.body !== '' ? <PermissionInput label={prompt.header} text={prompt.body} /> : <p className="text-sm text-muted">The dialog shows no command or change.</p>}
      <p className="text-xs text-muted">{`The terminal asks: ${prompt.question}`}</p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={inFlight}
          onClick={() => onDecide('deny')}
          className={`inline-flex h-am-hit items-center gap-1.5 rounded border border-danger bg-danger-bg px-3 text-sm font-medium text-danger-text disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
        >
          <X aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          Deny
        </button>
        <button
          type="button"
          disabled={inFlight}
          onClick={() => onDecide('allow')}
          className={`inline-flex h-am-hit items-center gap-1.5 rounded border border-primary bg-primary-light px-3 text-sm font-medium text-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
        >
          {inFlight ? <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm animate-spin motion-reduce:animate-none" /> : <Check aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />}
          Allow once
        </button>
      </div>
    </div>
  );
}
