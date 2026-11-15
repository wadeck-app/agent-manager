import { LoaderCircle, Paperclip, Plug, SendHorizontal, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Banner } from '../deps.js';
import { FOCUS_RING, IconButton } from '../deps.js';
import { Tooltip } from '../deps.js';
import { getPending, updatePending, usePending } from '../pending.js';
import { composerBlock } from './composerBlock.js';
import { deliveryItems, needsPolling } from './deliveryItems.js';
import { DeliveryList } from './DeliveryList.js';
import { getDraft, setDraft } from './draftStore.js';
import { ACCEPTED_MIMES } from './imagePipeline.js';
import { ImageThumbs } from './ImageThumbs.js';
import { formatBytes, sendProblem } from './limits.js';
import { PriorityControl } from './PriorityControl.js';
import type { AttachedImage } from './types.js';
import { useAttachImages } from './useAttachImages.js';
import { useReplyStatus } from './useReplyStatus.js';
import { useSendReply } from './useSendReply.js';
import type { ComposerProps } from './types.js';

/** Height of the field in pixels: 8 lines of 20 px plus padding. Beyond it the field scrolls. */
const MAX_FIELD_PX = 172;

export function ComposerBody({ session, reencode }: ComposerProps) {
  const sessionId = session.sessionId;
  const [text, setText] = useState(() => getDraft(sessionId).text);
  const [images, setImages] = useState<AttachedImage[]>(() => getDraft(sessionId).images);
  const [priority, setPriority] = useState<'next' | 'now'>('next');
  const [problems, setProblems] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const pending = usePending(sessionId);
  const live = useReplyStatus(sessionId, (answer) => needsPolling(answer?.messages ?? [], getPending(sessionId), Date.now()));
  const status = live.status;
  const { send, sending } = useSendReply(sessionId);
  const block = composerBlock({ alive: session.alive, loading: live.loading, status, error: live.error });
  const limits = status?.limits;
  const selected = status?.transports.find((transport) => transport.selected);

  // The server knows the real state of a message (the agent took it, or it failed): the local copy shown in the log follows it.
  useEffect(() => {
    for (const message of status?.messages ?? []) {
      const local = getPending(sessionId).find((entry) => entry.messageId === message.messageId);
      if (local !== undefined && local.state !== 'failed' && local.state !== message.ui) {
        updatePending(sessionId, message.messageId, { state: message.ui, error: message.ui === 'failed' ? message.reason : undefined });
      }
    }
  }, [status, sessionId]);

  // The field grows with its text up to MAX_FIELD_PX. A height set through the DOM is allowed by the content-security policy.
  useEffect(() => {
    const element = field.current;
    if (element !== null) {
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, MAX_FIELD_PX)}px`;
    }
  }, [text]);

  // The text and images as they are NOW: an attach that finishes later adds to these, never to the snapshot of the render that started it.
  const current = useRef({ text, images });
  const change = (nextText: string, nextImages: AttachedImage[]): void => {
    current.current = { text: nextText, images: nextImages };
    setText(nextText);
    setImages(nextImages);
    setDraft(sessionId, { text: nextText, images: nextImages });
  };
  const addImage = (image: AttachedImage, maxImages: number): boolean => {
    const { text: nowText, images: nowImages } = current.current;
    if (nowImages.length >= maxImages) {
      return false;
    }
    change(nowText, [...nowImages, image]);
    return true;
  };
  const attachFiles = useAttachImages({
    getCurrent: () => current.current,
    addImage,
    limits,
    onProblems: setProblems,
    onNotes: setNotes,
    reencode,
  });
  // Number of attaches still decoding: Send waits for them, else the message would leave without the image the user just pasted.
  const [attaching, setAttaching] = useState(0);
  const attach = async (files: readonly File[]): Promise<void> => {
    setAttaching((count) => count + 1);
    try {
      await attachFiles(files);
    } finally {
      setAttaching((count) => count - 1);
    }
  };

  const doSend = async (): Promise<void> => {
    setProblems([]);
    setNotes([]);
    const interrupting = priority === 'now';
    // Interrupt now is armed for ONE attempt: after a send, failed or not, it is disarmed (a retry must not abort another tool call by surprise).
    setPriority('next');
    const outcome = await send({ text, images, priority });
    if (!outcome.ok) {
      setProblems([
        `The message was not sent, your text and images are still here. ${outcome.error}${interrupting ? " Interrupt now was reset to After current step; arm it again to retry." : ''}`,
      ]);
      return;
    }
    change('', []);
    const { auditWarning, duplicate } = outcome.response;
    setNotes([...(duplicate ? ['This message had already been sent: nothing was sent twice.'] : []), ...(auditWarning === '' ? [] : [auditWarning])]);
    live.refresh();
  };

  const requestSend = (): void => {
    if (block !== undefined || sending || attaching > 0) {
      return;
    }
    const problem = limits === undefined ? 'The limits of the server are not known yet.' : sendProblem(text, images, limits);
    if (problem !== undefined) {
      setProblems([problem]);
      return;
    }
    setProblems([]);
    // Priority 'now' sends directly: choosing "Interrupt now" was the user's explicit confirmation (the chip's tooltip says what is lost). The server still
    // requires confirmNow: true for it, which useSendReply sets for exactly this case.
    void doSend();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.currentTarget.blur();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      requestSend();
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) {
      event.preventDefault();
      void attach(files);
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (!inactive && event.dataTransfer.files.length > 0) {
      void attach(Array.from(event.dataTransfer.files));
    }
  };

  const inactive = block !== undefined;
  const hint = limits === undefined ? '' : `Up to ${limits.maxImages} images of ${formatBytes(limits.maxImageBytes)} each, ${formatBytes(limits.maxBodyBytes)} in all.`;
  const items = deliveryItems(status?.messages ?? [], pending);
  // Armed with Interrupt now, the button says so (orange, lightning icon, its name): nobody sends an interruption by accident.
  const sendLabel = priority === 'now' ? 'Send and interrupt now' : 'Send';
  return (
    <div data-composer className="flex shrink-0 flex-col gap-2 border-t border-border bg-surface px-4 py-3">
      {block !== undefined ? (
        <Banner
          tone={block.kind === 'checking' ? 'info' : 'warning'}
          action={
            block.kind === 'blocked' && status === undefined ? (
              <button type="button" onClick={live.refresh} className={`shrink-0 rounded border border-warning px-2 py-0.5 text-xs ${FOCUS_RING}`}>
                Retry
              </button>
            ) : undefined
          }
        >
          {block.text}
        </Banner>
      ) : null}
      {problems.map((problem) => (
        <Banner key={problem} tone="error">
          {problem}
        </Banner>
      ))}
      {notes.map((note) => (
        <Banner key={note} tone="info">
          {note}
        </Banner>
      ))}
      <ImageThumbs images={images} disabled={sending} onRemove={(id) => change(current.current.text, current.current.images.filter((image) => image.id !== id))} />
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex items-end gap-1 rounded border bg-surface px-1.5 py-1.5 focus-within:ring-2 focus-within:ring-primary ${dragging ? 'border-primary bg-primary-light' : 'border-border'}`}
      >
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept={ACCEPTED_MIMES.join(',')}
          aria-label="Choose images to attach"
          onChange={(event) => {
            void attach(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <IconButton icon={Paperclip} label="Attach images" disabled={inactive || sending} disabledReason={inactive ? 'the session cannot receive messages' : undefined} onClick={() => picker.current?.click()} />
        <textarea
          ref={field}
          data-agent-composer
          rows={1}
          value={text}
          readOnly={sending}
          disabled={inactive}
          aria-label={`Message to ${session.displayName}`}
          placeholder={inactive ? 'Sending is not possible, see the message above' : priority === 'now' ? 'Interrupt now is armed: Enter sends and aborts the running tool call' : 'Message the agent (Enter sends, Shift+Enter adds a line)'}
          onChange={(event) => change(event.target.value, current.current.images)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="max-h-64 min-h-am-hit min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-base text-content placeholder:text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <Tooltip content={priority === 'now' ? 'Interrupts the running tool call right away, no further question. Enter or Ctrl+Enter.' : 'Enter or Ctrl+Enter'}>
          <button
            type="button"
            aria-label={sendLabel}
            disabled={inactive || sending || attaching > 0}
            title={attaching > 0 ? 'Waiting for the image to be prepared' : undefined}
            onClick={requestSend}
            className={`inline-flex h-am-hit w-am-hit shrink-0 items-center justify-center rounded border disabled:cursor-not-allowed disabled:opacity-50 ${priority === 'now' ? 'border-warning bg-warning-bg text-warning-text' : 'border-primary bg-primary-light text-primary'} ${FOCUS_RING}`}
          >
            {sending ? <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm animate-spin motion-reduce:animate-none" /> : priority === 'now' ? <Zap aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" /> : <SendHorizontal aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />}
          </button>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <PriorityControl priority={priority} onChange={setPriority} disabled={inactive || sending} />
        <div className="flex items-center gap-3 text-xs text-muted">
          {attaching > 0 ? <span role="status">Preparing the image, Send is available when it is attached.</span> : null}
          {hint !== '' ? <span className="hidden xl:inline">{hint}</span> : null}
          {selected !== undefined ? (
            <Tooltip content={`Sent through the ${selected.transportId} transport (${selected.description}). Chosen from ${status?.selectedFrom ?? 'the configuration'}; switching transports is a CLI or configuration matter for now, not done here.`}>
              <span className="inline-flex items-center gap-1">
                <Plug aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
                via {selected.transportId}
              </span>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <DeliveryList items={items} />
    </div>
  );
}
