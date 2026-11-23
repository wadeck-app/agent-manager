import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { Keyboard, Paperclip, SendHorizontal, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Banner, CountBadge, useMediaQuery } from '../deps.js';
import { FOCUS_RING } from '../deps.js';
import { Tooltip } from '../deps.js';
import { getPending } from '../pending.js';
import { composerBlock } from './composerBlock.js';
import { needsPolling } from './deliveryItems.js';
import { getDraft, setDraft } from './draftStore.js';
import { ACCEPTED_MIMES } from './imagePipeline.js';
import { ImageThumbs } from './ImageThumbs.js';
import { formatBytes, sendProblem } from './limits.js';
import { PriorityControl } from './PriorityControl.js';
import { TransportPicker } from './TransportPicker.js';
import { typedWarning } from './TransportRow.js';
import type { AttachedImage } from './types.js';
import { useAttachImages } from './useAttachImages.js';
import { useReplyStatus } from './useReplyStatus.js';
import { useSendReply } from './useSendReply.js';
import { useSyncDelivery } from './useSyncDelivery.js';
import type { ReplyMarkerMode } from '../deps.js';
import type { ComposerProps } from './types.js';

/** Height of the field in pixels: 8 lines of 20 px plus padding. Beyond it the field scrolls. */
const MAX_FIELD_PX = 172;

/** What goes in front of the text, as the status says (the replyMarker setting of config.yml, none by default): never claims a marker that is not sent. */
const MARKER_SENTENCE: Record<ReplyMarkerMode, string> = {
  none: 'Sent as typed, with no marker line.',
  short: 'A short marker line ([agent-manager-web #id]) is added before the text.',
  full: 'A marker line ([web reply via agent-manager #id]) is added before the text.',
};

// An unknown setting (null: the status could not read it, the banner says why) says nothing rather than something wrong.
function markerSentence(marker: ReplyMarkerMode | null | undefined): string {
  return marker === null || marker === undefined ? '' : MARKER_SENTENCE[marker];
}

export function ComposerBody({ session, reencode }: ComposerProps) {
  const sessionId = session.sessionId;
  // A phone: the hint of the keys would wrap to a second line of the one-line box and be cut.
  const narrow = useMediaQuery('(max-width: 639px)');
  const [text, setText] = useState(() => getDraft(sessionId).text);
  const [images, setImages] = useState<AttachedImage[]>(() => getDraft(sessionId).images);
  const [priority, setPriority] = useState<'next' | 'now'>('next');
  const [problems, setProblems] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Every transport is probed only while the transport menu is open (an hc probe spawns one process per terminal).
  const [menuOpen, setMenuOpen] = useState(false);
  const live = useReplyStatus(sessionId, (answer) => needsPolling(answer?.messages ?? [], getPending(sessionId), Date.now()), menuOpen);
  const status = live.status;
  // The session came back (a resume) or went away (a stop): the transports are probed again, the last answer was about the other state.
  const { refresh: refreshStatus } = live;
  const lifeKey = `${session.alive}:${session.ownedState ?? ''}`;
  const lastLife = useRef(lifeKey);
  useEffect(() => {
    if (lastLife.current !== lifeKey) {
      lastLife.current = lifeKey;
      refreshStatus();
    }
  }, [lifeKey, refreshStatus]);
  const { send, sending } = useSendReply(sessionId);
  const block = composerBlock({ alive: session.alive, loading: live.loading, status, error: live.error, ownedState: session.ownedState });
  const limits = status?.limits;
  const selectedTransport = status?.transports.find((transport) => transport.selected);
  const typed = selectedTransport?.deliveredAs === 'typed';
  const markerTip = markerSentence(selectedTransport?.marker);

  // The state of the sent messages follows the server; the log shows them (marks on the bubbles), there is no list here.
  useSyncDelivery(sessionId, status?.messages);

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
  // The limits are said where they matter: in the tooltip of the attach button (hover and keyboard focus), and as the counter on it once an image is attached.
  const limitsText = limits === undefined ? '' : `Up to ${limits.maxImages} images of ${formatBytes(limits.maxImageBytes)} each, ${formatBytes(limits.maxBodyBytes)} in all.`;
  const attachName = images.length > 0 && limits !== undefined ? `Attach images (${images.length} of ${limits.maxImages} attached)` : 'Attach images';
  const attachTip = inactive ? `Attach images: the session cannot receive messages` : limitsText === '' ? 'Attach images' : `Attach images. ${limitsText}`;
  // Armed with Interrupt now, the button says so (orange, lightning icon, its name): nobody sends an interruption by accident.
  const sendLabel = priority === 'now' ? 'Send and interrupt now' : 'Send';
  return (
    <div data-composer className="flex shrink-0 flex-col gap-2 border-t border-border bg-surface px-4 py-3">
      {block !== undefined ? (
        <Banner
          tone={block.kind === 'checking' ? 'info' : 'warning'}
          action={
            block.kind === 'blocked' && status === undefined ? (
<ButtonAction variant="secondary" size="sm" label="Retry" onClick={live.refresh} />
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
        <IconButton
          variant="ghost"
          className="relative"
          aria-label={attachName}
          title={attachTip}
          disabled={inactive || sending}
          onClick={() => picker.current?.click()}
          icon={
            <>
              <Paperclip aria-hidden="true" className="h-4 w-4" />
              {images.length > 0 && limits !== undefined ? (
                <CountBadge aria-hidden="true" className="absolute -right-0.5 -top-0.5">
                  {images.length}/{limits.maxImages}
                </CountBadge>
              ) : null}
            </>
          }
        />
        <textarea
          ref={field}
          data-agent-composer
          rows={1}
          value={text}
          readOnly={sending}
          disabled={inactive}
          aria-label={`Message to ${session.displayName}`}
          placeholder={inactive ? 'Sending is not possible, see the message above' : priority === 'now' ? 'Interrupt now is armed: Enter sends and aborts the running tool call' : narrow ? 'Message the agent' : 'Message the agent (Enter sends, Shift+Enter adds a line)'}
          onChange={(event) => change(event.target.value, current.current.images)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="max-h-64 min-h-am-hit min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-base text-content placeholder:text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        {typed ? (
          <Tooltip content={`Sends as typed by you. ${typedWarning(selectedTransport?.transportId ?? '')}`}>
            <span data-typed-cue="" tabIndex={0} aria-label="Sends as typed by you" className={`inline-flex h-am-hit shrink-0 items-center text-muted ${FOCUS_RING}`}>
              <Keyboard aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            </span>
          </Tooltip>
        ) : null}
        {/* The base primary icon button, like every other primary button of the shell (danger while the interrupt is armed). */}
        <IconButton
          variant={priority === 'now' ? 'danger' : 'primary'}
          aria-label={sendLabel}
          title={attaching > 0 ? 'Waiting for the image to be prepared' : `${priority === 'now' ? 'Interrupts the running tool call right away, no further question. Enter or Ctrl+Enter.' : 'Enter or Ctrl+Enter.'}${markerTip === '' ? '' : ` ${markerTip}`}`}
          disabled={inactive || sending || attaching > 0}
          loading={sending}
          onClick={requestSend}
          icon={priority === 'now' ? <Zap aria-hidden="true" className="h-4 w-4" /> : <SendHorizontal aria-hidden="true" className="h-4 w-4" />}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <PriorityControl priority={priority} onChange={setPriority} disabled={inactive || sending} />
        <div className="flex items-center gap-3 text-xs text-muted">
          {attaching > 0 ? <span role="status">Preparing the image, Send is available when it is attached.</span> : null}
          {/* A background session has no direct pipe: what the transport picker shows (socket) is a peer message, said once in words (only when the socket transport is the selected one). */}
          {session.host === 'bg' && selectedTransport?.transportId === 'socket' ? <span data-bg-peer-note="">Sent as a peer message (a background session has no direct pipe)</span> : null}
          {/* The transport: a small control that opens the list of transports (TransportPicker). */}
          <div data-composer-transport="" className="flex items-center">
            <TransportPicker sessionId={sessionId} status={status} onChanged={live.refresh} onOpenChange={setMenuOpen} />
          </div>
        </div>
      </div>
    </div>
  );
}
