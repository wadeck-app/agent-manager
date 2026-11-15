import { Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export type BannerTone = 'error' | 'warning' | 'info';

const TONE_CLASS: Record<BannerTone, string> = {
  error: 'border-danger bg-danger-bg text-danger-text',
  warning: 'border-warning bg-warning-bg text-warning-text',
  info: 'border-border bg-info-bg text-info-text',
};

export interface BannerProps {
  tone: BannerTone;
  children: ReactNode;
  /** The action that can fix it ("Retry"), rendered at the end. */
  action?: ReactNode;
}

/** A message the user must see: errors are announced (role alert), the others politely (role status). Never blank, never a console-only error. */
export function Banner({ tone, children, action }: BannerProps) {
  const Icon = tone === 'info' ? Info : TriangleAlert;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${TONE_CLASS[tone]}`}>
      <Icon aria-hidden="true" className="mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {action}
    </div>
  );
}
