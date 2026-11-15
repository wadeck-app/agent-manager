import { LoaderCircle, Target, X } from 'lucide-react';
import { Banner, FOCUS_RING } from '../deps.js';
import { CopyButton } from './CopyButton.js';
import type { LocateFeed } from './useLocateCall.js';

const BUTTON = `inline-flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-xs ${FOCUS_RING}`;

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
        <div role="status" className="flex shrink-0 flex-col gap-1.5 border-b border-border bg-primary-light px-3 py-2 text-sm text-content">
          <div className="flex items-center gap-2">
            <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 animate-spin text-primary motion-reduce:animate-none" />
            <span className="min-w-0 flex-1 truncate">
              Looking for the call that started "{state.label}"...{state.page > 0 ? ` (${state.page} ${state.page === 1 ? 'page' : 'pages'} of older entries loaded)` : ''}
            </span>
            <button type="button" onClick={feed.cancel} className={`${BUTTON} border-border text-content hover:bg-muted-bg`}>
              Cancel
            </button>
          </div>
          <div role="progressbar" aria-label="Search for the call" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress * 100)} className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
            <span className="block h-full bg-primary-solid" style={{ width: `${Math.max(4, Math.round(state.progress * 100))}%` }} />
          </div>
        </div>
      );
    case 'found':
      return (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-border bg-primary-light px-3 py-1.5 text-sm text-content">
          <Target aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">Showing the call that started "{state.label}"</span>
          <button type="button" onClick={feed.clear} className={`${BUTTON} border-border text-content hover:bg-surface`}>
            <X aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            Clear
          </button>
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
                  <button type="button" onClick={feed.retry} className={`${BUTTON} border-warning text-warning-text hover:bg-surface`}>
                    Search older entries
                  </button>
                ) : null}
                {state.toolUseId !== undefined ? <CopyButton text={state.toolUseId} label="Copy the call id (to look it up in the transcript)" /> : null}
                <button type="button" onClick={feed.clear} className={`${BUTTON} border-warning text-warning-text hover:bg-surface`}>
                  Dismiss
                </button>
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
                <button type="button" onClick={feed.retry} className={`${BUTTON} border-danger text-danger-text hover:bg-surface`}>
                  Try again
                </button>
                <button type="button" onClick={feed.clear} className={`${BUTTON} border-danger text-danger-text hover:bg-surface`}>
                  Dismiss
                </button>
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
