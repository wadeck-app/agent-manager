import { ButtonAction } from '@wadeck-app/dsl-ui';
import { Keyboard, Plug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FOCUS_RING, Tooltip, failureText, requestJson } from '../deps.js';
import type { ReplyDefaultTransportSetResponse, ReplyStatusOk, ReplyTransportSetResponse } from '../deps.js';
import { usePopover } from '../deps.js';
import { TransportRow } from './TransportRow.js';

export interface TransportPickerProps {
  sessionId: string;
  status: ReplyStatusOk | undefined;
  /** Ask for the reply status again (the server config changed). */
  onChanged: () => void;
  /** The popover opened or closed: the caller then asks the status with every transport probed (only the selected one is probed otherwise). */
  onOpenChange?: (open: boolean) => void;
}

/**
 * The transport of the composer: a small control (icon and the name in use) that opens a popover with every transport the module knows, how each delivers,
 * whether it works now (a short cause and fix when not; the whole text is behind Details), and the choices: use it here, make it the default, or follow the default again. The server config is the source of
 * truth: nothing is kept here, the status is asked again after a change. A refused change is written in the popover with its hint.
 */
export function TransportPicker({ sessionId, status, onChanged, onOpenChange }: TransportPickerProps) {
  const { open, setOpen, box, panelId } = usePopover('button:not([disabled])');
  const openRef = useRef(open);
  useEffect(() => {
    if (openRef.current !== open) {
      openRef.current = open;
      onOpenChange?.(open);
    }
  }, [open, onOpenChange]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = status?.transports.find((transport) => transport.selected);
  if (status === undefined || selected === undefined) {
    return null;
  }
  const Icon = selected.deliveredAs === 'typed' ? Keyboard : Plug;

  const change = async (run: () => Promise<{ ok: true } | { ok: false; text: string }>): Promise<void> => {
    setBusy(true);
    setError('');
    const result = await run();
    setBusy(false);
    if (result.ok) {
      onChanged();
    } else {
      setError(result.text);
    }
  };
  const setSession = (transportId: string | null): Promise<void> =>
    change(async () => {
      const result = await requestJson<ReplyTransportSetResponse>(`/sessions/${encodeURIComponent(sessionId)}/reply/transport`, { method: 'PUT', body: { transportId } });
      if (!result.ok) {
        return result;
      }
      return result.value.ok ? { ok: true } : { ok: false, text: failureText(result.value, 200) };
    });
  const setDefault = (transportId: string): Promise<void> =>
    change(async () => {
      const result = await requestJson<ReplyDefaultTransportSetResponse>('/reply/transport/default', { method: 'PUT', body: { transportId } });
      if (!result.ok) {
        return result;
      }
      return result.value.ok ? { ok: true } : { ok: false, text: failureText(result.value, 200) };
    });

  const trigger = (
    <button
      type="button"
      aria-label={`Transport: ${selected.transportId}`}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={() => setOpen(!open)}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-muted-bg hover:text-content ${open ? 'bg-muted-bg text-content' : ''} ${FOCUS_RING}`}
    >
      <Icon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
      {selected.transportId}
    </button>
  );

  return (
    <div ref={box} data-transport-picker="" className="relative">
      {/* While the popover is open the tooltip would sit on top of it: the button alone then. */}
      {open ? (
        trigger
      ) : (
        <Tooltip content={`Sent through the ${selected.transportId} transport: ${selected.deliveredAsText}. Click to change it.`}>{trigger}</Tooltip>
      )}
      {open ? (
        <div id={panelId} role="dialog" aria-label="Transport" className="absolute bottom-full right-0 z-30 mb-1 flex w-[26rem] max-w-[92vw] flex-col gap-2 rounded-lg border border-border bg-surface p-2 text-content shadow-lg">
          <p className="px-1 text-xs text-muted" title="The setting is kept by the module, the same as the transport command of the CLI.">
            How replies reach this session
          </p>
          {error !== '' ? (
            <p role="alert" className="rounded border border-danger bg-danger-bg px-2 py-1 text-xs text-danger-text">
              {error}
            </p>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {status.transports.map((transport) => (
              <TransportRow key={transport.transportId} transport={transport} busy={busy} onSession={(id) => void setSession(id)} onDefault={(id) => void setDefault(id)} />
            ))}
          </ul>
          {status.sessionOverrideTransportId !== null ? (
            <span className="self-start">
              <ButtonAction variant="secondary" size="sm" disabled={busy} onClick={() => void setSession(null)} label={`Follow the default (${status.defaultTransportId})`} />
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
