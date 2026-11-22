import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { FolderPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { checkGroupName } from '../shared.js';
import { FOCUS_RING } from '../ui/focusRing.js';

/**
 * The "New group" button of the toolbar. It turns into a name field in place: Enter creates, Escape (or the Cancel button) puts the button back. A bad name is
 * said next to the field; a refusal of the server is shown by the page, and the field stays so the name can be corrected.
 */
export function NewGroupControl({ onCreate, iconOnly = false }: { onCreate: (name: string) => Promise<boolean>; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The base buttons take no ref: the focus goes back to the button through its wrapper.
  const button = useRef<HTMLSpanElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      input.current?.focus();
    } else if (wasOpen.current) {
      button.current?.querySelector('button')?.focus();
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
      <span ref={button} className="inline-flex">
        {iconOnly ? (
          <IconButton variant="secondary" aria-label="New group" icon={<FolderPlus aria-hidden="true" className="h-3.5 w-3.5" />} onClick={() => setOpen(true)} />
        ) : (
          <ButtonAction variant="secondary" icon={<FolderPlus aria-hidden="true" className="h-3.5 w-3.5" />} label="New group" onClick={() => setOpen(true)} />
        )}
      </span>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
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
      <ButtonAction variant="primary" size="sm" type="submit" label="Create" loading={busy} />
      <ButtonAction variant="secondary" size="sm" label="Cancel" onClick={close} />
      {problem !== '' ? (
        <span id="new-group-problem" role="alert" className="text-sm text-danger">
          {problem}
        </span>
      ) : null}
    </form>
  );
}
