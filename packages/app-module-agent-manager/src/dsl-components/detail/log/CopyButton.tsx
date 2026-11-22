import { IconButton } from '@wadeck-app/dsl-ui';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FOCUS_RING } from '../deps.js';
import { Tooltip } from '../deps.js';
import { LOG_ICON_SM } from './sizes.js';

/** A small icon button that copies `text`. A clipboard that refuses (no permission, insecure page) says so in the tooltip: never a silent no-op. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [reason, setReason] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = (): void => {
    const done = (next: 'copied' | 'failed', why = ''): void => {
      setState(next);
      setReason(why);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 2500);
    };
    if (navigator.clipboard === undefined) {
      done('failed', 'the browser gives no clipboard access on this page (it needs https or localhost)');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => done('copied'),
      (error: unknown) => done('failed', String(error)),
    );
  };

  const Icon = state === 'copied' ? Check : state === 'failed' ? TriangleAlert : Copy;
  const name = state === 'copied' ? 'Copied' : state === 'failed' ? `Copy failed: ${reason}` : label;
  return (
<IconButton size="icon-sm" aria-label={name} onClick={copy} icon={<Icon aria-hidden="true" className={`h-3.5 w-3.5 ${state === 'failed' ? 'text-danger-text' : ''}`} />} />
  );
}
