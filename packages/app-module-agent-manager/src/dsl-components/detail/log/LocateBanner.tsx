import { ButtonAction } from '@wadeck-app/dsl-ui';
import { LoaderCircle, Target, X } from 'lucide-react';
import { Banner } from '../deps.js';
import { CopyButton } from './CopyButton.js';
import type { LocateFeed } from './useLocateCall.js';

const LOCATE_BANNER = 'flex shrink-0 flex-col gap-1.5 border-b border-border bg-primary-light px-3 py-2 text-sm text-content';
const LOCATE_SPINNER = 'h-am-icon-sm w-am-icon-sm shrink-0 animate-spin text-primary motion-reduce:animate-none';
const LOCATE_BANNER_LINE = 'flex shrink-0 items-center gap-2 border-b border-border bg-primary-light px-3 py-1.5 text-sm text-content';

/**
 * What the click on a sub-agent did, above the log where the eye is: the search in progress (with a progress bar and Cancel), the call being shown (a slim
 * persistent line with Clear), or why the call cannot be shown (a banner with what happened and what can be done). Nothing here is a toast that disappears.
 */
export function LocateBanner({ feed }: { feed: LocateFeed }) {
  const { state } = feed;
  switch (state.phase) {
    case 'idle':
    case 'verifying':
      return null;
    case 'searching':
      return (
        <div role="status" className={LOCATE_BANNER}>
          <div className="flex items-center gap-2">
            <LoaderCircle aria-hidden="true" className={LOCATE_SPINNER} />
            <span className="min-w-0 flex-1 truncate">
              Looking for the call that started "{state.label}"...{state.page > 0 ? ` (${state.page} ${state.page === 1 ? 'page' : 'pages'} of older entries loaded)` : ''}
            </span>
<ButtonAction variant="secondary" size="sm" label="Cancel" onClick={feed.cancel} />
          </div>
          <div role="progressbar" aria-label="Search for the call" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress * 100)} className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
            <span className="block h-full bg-primary-solid" style={{ width: `${Math.max(4, Math.round(state.progress * 100))}%` }} />
          </div>
        </div>
      );
    case 'found':
      return (
        <div role="status" className={LOCATE_BANNER_LINE}>
          <Target aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">Showing the call that started "{state.label}"</span>
<ButtonAction variant="secondary" size="sm" icon={<X aria-hidden="true" className="h-3.5 w-3.5" />} label="Clear" onClick={feed.clear} />
        </div>
      );
    case 'missing':
      return (
        <div className="shrink-0 border-b border-border p-2">
          <Banner
            tone="warning"
            action={
              <span className="flex shrink-0 items-center gap-1.5">
                {state.canSearchAgain ? (
<ButtonAction variant="secondary" size="sm" label="Search older entries" onClick={feed.retry} />
                ) : null}
                {state.toolUseId !== undefined ? <CopyButton text={state.toolUseId} label="Copy the call id (to look it up in the transcript)" /> : null}
<ButtonAction variant="secondary" size="sm" label="Dismiss" onClick={feed.clear} />
              </span>
            }
          >
            <span className="font-medium">Call not shown. </span>
            {state.message}
          </Banner>
        </div>
      );
    case 'error':
      return (
        <div className="shrink-0 border-b border-border p-2">
          <Banner
            tone="error"
            action={
              <span className="flex shrink-0 items-center gap-1.5">
<ButtonAction variant="secondary" size="sm" label="Try again" onClick={feed.retry} />
<ButtonAction variant="secondary" size="sm" label="Dismiss" onClick={feed.clear} />
              </span>
            }
          >
            <span className="font-medium">The search for the call failed. </span>
            {state.message} {state.hint}
          </Banner>
        </div>
      );
  }
}

/** The words a screen reader gets while a search runs and when the call is shown (a polite live region). The banners of a failure announce themselves (role status / alert). */
export function locateAnnouncement(feed: LocateFeed): string {
  const { state } = feed;
  switch (state.phase) {
    case 'searching':
      return `Looking for the call that started ${state.label}`;
    case 'found':
      return `Showing the call that started ${state.label}`;
    case 'idle':
    case 'verifying':
    case 'missing':
    case 'error':
      return '';
  }
}
