import { LogViewerBody } from './LogViewerBody.js';
export type { LogViewerProps } from './logViewerTypes.js';
import type { LogViewerProps } from './logViewerTypes.js';

/** The log of the selected session, one of three styles, filling its parent. A new session id starts from scratch (state is keyed by it). */
export function LogViewer(props: LogViewerProps) {
  return <LogViewerBody key={props.session.sessionId} {...props} />;
}
