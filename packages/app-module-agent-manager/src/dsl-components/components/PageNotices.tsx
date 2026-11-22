import { registryNotices } from '../logic/notices.js';
import { NoticeStrip } from '../ui/Notices.js';
import { Scope } from '../ui/Scope.js';

export interface PageNoticesProps {
  /** `$sources.sessions.errorText`: the registry could not be listed (the answer is `ok: false`, answered as data). Empty or absent: none. */
  errorText?: string;
  /** `$sources.sessions.unreadableText`: registry files that could not be read (their sessions are not shown). Empty or absent: none. */
  unreadableText?: string;
}

/**
 * The problems of a page of sessions (Table, and the Agents page when the registry cannot be listed) as ONE compact line: a short sentence, Copy fix, Details
 * and a dismissal that is remembered per message for the browser session. Renders nothing when there is nothing to say.
 *
 * @registryCategory atomic
 * @registryTags notices errors sessions
 */
export function PageNotices({ errorText, unreadableText }: PageNoticesProps) {
  return (
    <Scope>
      {/* pt-4 = the space-y-4 of PageContent: the host wrapper of a custom component does not get that margin. */}
      <div className="pt-4">
        <NoticeStrip items={registryNotices({ errorText: errorText ?? '', unreadableText: unreadableText ?? '' })} />
      </div>
    </Scope>
  );
}
