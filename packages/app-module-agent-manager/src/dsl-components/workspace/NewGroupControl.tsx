import { FolderPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { checkGroupName } from '../shared.js';
import { FOCUS_RING } from '../ui/IconButton.js';

/**
 * The "New group" button of the toolbar. It turns into a name field in place: Enter creates, Escape (or the Cancel button) puts the button back. A bad name is
 * said next to the field; a refusal of the server is shown by the page, and the field stays so the name can be corrected.
 */
export function NewGroupControl({ onCreate }: { onCreate: (name: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      input.current?.focus();
    } else if (wasOpen.current) {
      button.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  const close = (): void => {
    setOpen(false);
    setName('');
    setProblem('');
  };
  const submit = async (): Promise<void> => {
    const checked = checkGroupName(name);
    if (!checked.ok) {
      setProblem(checked.text);
      return;
    }
    setProblem('');
    setBusy(true);
    const created = await onCreate(checked.name);
    setBusy(false);
    if (created) {
      close();
    } else {
      setProblem('The group was not created: see the message at the top of the page.');
    }
  };

  if (!open) {
    return (
      <button ref={button} type="button" onClick={() => setOpen(true)} className={`inline-flex h-am-hit items-center gap-1.5 rounded border border-border px-3 text-sm font-medium text-content hover:bg-muted-bg ${FOCUS_RING}`}>
        <FolderPlus aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
        New group
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="sr-only" htmlFor="new-group-name">
        Name of the new group
      </label>
      <input
        ref={input}
        id="new-group-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        maxLength={80}
        placeholder="Name of the group"
        aria-invalid={problem !== ''}
        aria-describedby={problem === '' ? undefined : 'new-group-problem'}
        className={`h-am-hit w-44 rounded border border-border bg-surface px-2 text-sm text-content ${FOCUS_RING}`}
      />
      <button type="submit" disabled={busy} className={`inline-flex h-am-hit items-center rounded border border-primary bg-primary-light px-3 text-sm font-medium text-primary disabled:opacity-60 ${FOCUS_RING}`}>
        Create
      </button>
      <button type="button" onClick={close} className={`inline-flex h-am-hit items-center rounded border border-border px-3 text-sm text-content hover:bg-muted-bg ${FOCUS_RING}`}>
        Cancel
      </button>
      {problem !== '' ? (
        <span id="new-group-problem" role="alert" className="text-sm text-danger">
          {problem}
        </span>
      ) : null}
    </form>
  );
}
