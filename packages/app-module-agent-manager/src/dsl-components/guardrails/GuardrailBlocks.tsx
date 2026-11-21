import { ShieldAlert } from 'lucide-react';
import { CopyButton } from '../detail/log/CopyButton.js';
import { blockedText, bypassCommand } from '../logic/guardrails.js';
import type { GuardrailBlocksDto } from '../shared.js';

/**
 * The detail header version: the sentence, a link to the Guardrails page and, per category, a button that copies `/w-guardrails:request-bypass <category> once`.
 * The module grants nothing: the user runs the command in that session and answers the plugin's own dialog there.
 */
export function GuardrailBlocks({ blocks }: { blocks: GuardrailBlocksDto | undefined }) {
  if (blocks === undefined) {
    return null;
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-hue-orange">
      <ShieldAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
      <span>{blockedText(blocks)}</span>
      {blocks.timeout ? <span className="text-warning-text">Bypass requests are timed out</span> : null}
      <a href="/guardrails" className="text-primary underline">
        Guardrails page
      </a>
      <ul aria-label="Copy a bypass command" className="flex flex-wrap items-center gap-x-1">
        {blocks.categories.slice(0, 3).map((item) => (
          <li key={item.category} className="flex items-center text-xs text-muted">
            {item.category}
            <CopyButton text={bypassCommand(item.category)} label={`Copy ${bypassCommand(item.category)}: run it in this session yourself, the module grants nothing`} />
          </li>
        ))}
      </ul>
    </div>
  );
}
