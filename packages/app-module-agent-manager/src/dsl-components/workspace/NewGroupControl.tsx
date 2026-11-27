import { ButtonAction } from '@wadeck-app/dsl-ui';
import { FolderPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { checkGroupName } from '../shared.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { POPUP_SURFACE } from '../ui/popupSurface.js';
import { BareInput } from '../ui/BareInput.js';

/**
 * The "New group" button of the list footer. It opens a small popup ABOVE the footer (an overlay anchored to the footer, so it never pushes the list and fits the
 * 240 px list pane): a name field, Create and Cancel. Enter creates, Escape, Cancel or a click outside close it and put the focus back on the button. A bad name is
 * said in the popup; a refusal of the server is shown by the page, and the popup stays so the name can be corrected.
 */
export function NewGroupControl({ onCreate }: { onCreate: (name: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The wrapper holds the button and the popup: the base buttons take no ref, so the focus goes back to the button through it.
  const box = useRef<HTMLSpanElement>(null);
  const wasOpen = useRef(false);
  // False when the popup closed because the user clicked somewhere else: the focus stays where that click put it.
  const refocus = useRef(true);

  useEffect(() => {
    if (open) {
      input.current?.focus();
    } else if (wasOpen.current && refocus.current) {
      box.current?.querySelector('button')?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  // A click outside the button and the popup closes it (the typed name is dropped, as with Cancel).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent): void => {
      if (box.current !== null && event.target instanceof Node && !box.current.contains(event.target)) {
        refocus.current = false;
        setOpen(false);
        setName('');
        setProblem('');
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = (): void => {
    refocus.current = true;
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

  return (
    <span ref={box} className="inline-flex">
      <ButtonAction variant="secondary" size="sm" icon={<FolderPlus aria-hidden="true" className="h-3.5 w-3.5" />} label="New group" onClick={() => {
          refocus.current = true;
          setOpen(true);
        }} />
      {open ? (
        // Anchored to the footer (the nearest positioned ancestor): the width of the list pane, above the bar.
        <form
          role="dialog"
          aria-label="New group"
          className={`absolute inset-x-2 bottom-full z-30 mb-1 flex flex-col gap-2 ${POPUP_SURFACE} p-2`}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="sr-only" htmlFor="new-group-name">
            Name of the new group
          </label>
          <BareInput
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
            className={`h-7 w-full rounded border border-border bg-surface px-2 text-sm text-content ${FOCUS_RING}`}
          />
          {problem !== '' ? (
            <span id="new-group-problem" role="alert" className="text-sm text-danger">
              {problem}
            </span>
          ) : null}
          <div className="flex justify-end gap-2">
            <ButtonAction variant="secondary" size="sm" label="Cancel" onClick={close} />
            <ButtonAction variant="primary" size="sm" type="submit" label="Create" loading={busy} />
          </div>
        </form>
      ) : null}
    </span>
  );
}
