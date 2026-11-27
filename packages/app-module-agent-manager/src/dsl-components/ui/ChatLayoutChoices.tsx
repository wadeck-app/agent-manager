import { useId } from 'react';
import { CHAT_LAYOUT_CHOICES, CHAT_LAYOUT_IDS, DEFAULT_CHAT_LAYOUT } from '../logic/chatLayoutPref.js';
import { useChatLayoutControl } from './ChatLayoutContext.js';
import { StyledRadio } from './StyledRadio.js';

/**
 * The radio group of the chat layouts, one line of description each. Used by the list menu (Chat section) and by the log filter popup: both edit the same saved
 * value (ChatLayoutContext), so a pick in one shows in the other and in the log at once. There is no reset button: the default is named in its own label.
 */
export function ChatLayoutChoices({ name }: { name: string }) {
  const { layout, setLayout } = useChatLayoutControl();
  const labelId = useId();
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-0.5" data-chat-layout-choices="">
      <span id={labelId} className="sr-only">
        Chat layout
      </span>
      {CHAT_LAYOUT_IDS.map((id) => (
        <label key={id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-muted-bg">
          <StyledRadio name={name} value={id} checked={layout === id} onChange={() => setLayout(id)} className="mt-1" />
          <span className="flex flex-col">
            <span className="text-sm text-content">{id === DEFAULT_CHAT_LAYOUT ? `${CHAT_LAYOUT_CHOICES[id].label} (default)` : CHAT_LAYOUT_CHOICES[id].label}</span>
            <span className="text-xs text-muted">{CHAT_LAYOUT_CHOICES[id].hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
