import { ButtonAction } from '@wadeck-app/dsl-ui';
import { Check, Keyboard, ShieldAlert, X } from 'lucide-react';
import type { HcPermissionPromptDto } from '../shared.js';
import { Chip } from '../ui/Chip.js';
import { PermissionInput } from './PermissionInput.js';

const HC_WARNING = 'flex items-start gap-1.5 rounded border border-warning bg-warning-bg px-2 py-1 text-xs text-warning-text';
const HC_NOTICE = 'whitespace-pre-wrap break-words rounded border border-border bg-surface px-2 py-1.5 text-sm text-content';

/** The dialog the terminal shows: what it asks, the command in full (folded when large), the warning that a click types a key, and the two buttons. */
export function HcPermissionPrompt({ prompt, inFlight, onDecide }: { prompt: HcPermissionPromptDto; inFlight: boolean; onDecide: (decision: 'allow' | 'deny') => void }) {
  const title = prompt.tool === undefined ? prompt.header : `${prompt.tool}: ${prompt.header}`;
  return (
    <div data-hc-permission={prompt.promptId} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <ShieldAlert aria-hidden="true" className="h-am-icon w-am-icon shrink-0 text-hue-red" />
        <h3 className="text-sm font-semibold text-content">{`Permission request: ${title}`}</h3>
        <Chip variant="neutral">{`terminal ${prompt.terminal}`}</Chip>
      </div>
      {/* The warning of the header: what a click does is a key typed into a real terminal. */}
      <p data-hc-warning="" className={HC_WARNING}>
        <Keyboard aria-hidden="true" className="mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0" />
        <span>
          This answers the dialog in the terminal by typing the key there: <strong>Allow once</strong> types Enter (option 1, Yes), <strong>Deny</strong> types Esc (cancel). The terminal is not checked again after the key, only before it. &quot;Always allow&quot; is never selected from this page.
        </span>
      </p>
      {prompt.description !== '' ? <p className="text-sm text-content">{prompt.description}</p> : null}
      {prompt.body !== '' ? <PermissionInput label={prompt.header} text={prompt.body} /> : <p className="text-sm text-muted-tint">The dialog shows no command or change.</p>}
      {/* Text the terminal prints between the command and the question (a hook reason): shown whole, apart from the command. */}
      {prompt.notice !== '' ? (
        <div data-hc-notice="" className="flex flex-col gap-1">
          <p className="text-xs text-muted-tint">Shown by the terminal below the command:</p>
          <pre className={HC_NOTICE}>{prompt.notice}</pre>
        </div>
      ) : null}
      <p className="text-xs text-muted-tint">{`The terminal asks: ${prompt.question}`}</p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ButtonAction variant="danger-outline" disabled={inFlight} onClick={() => onDecide('deny')} icon={<X aria-hidden="true" className="h-4 w-4" />} label="Deny" />
        <ButtonAction variant="primary" loading={inFlight} onClick={() => onDecide('allow')} icon={<Check aria-hidden="true" className="h-4 w-4" />} label="Allow once" />
      </div>
    </div>
  );
}
