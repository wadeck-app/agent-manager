import { useAbTest, useRegisterAbTests } from '@wadeck-app/dsl-ui';
import type { AgentRow } from '../data/types.js';
import type { LogStyle } from '../shared.js';
import { Composer } from './composer/Composer.js';
import { LogViewer } from './log/LogViewer.js';

/**
 * What the detail pane shows under the header: the log of the session (scrolls inside) and the reply box (fixed at the bottom). The style of the log is the
 * A/B test `detail-log-style` declared here in code (a YAML AbTest cannot hand a value to a component), shown in the same dock as the layout tests;
 * `logStyle` forces one (tests, or a caller that wants a fixed style).
 */
export interface AgentDetailProps {
  session: AgentRow;
  logStyle?: LogStyle;
}

export function AgentDetail({ session, logStyle }: AgentDetailProps) {
  const test = useAbTest<LogStyle>({
    id: 'detail-log-style',
    label: 'Log style',
    initial: 'chat',
    options: {
      chat: { label: 'Chat', hint: 'Bubbles: your messages on the right, the agent on the left, tool calls as one collapsed line between them.' },
      timeline: { label: 'Timeline', hint: 'A vertical rail with a dot and a time per entry; every entry has the same width, nothing is right-aligned.' },
      compact: { label: 'Compact', hint: 'Terminal-like: one monospace line per entry, no bubbles, the densest view for long sessions.' },
    },
  });
  useRegisterAbTests(logStyle === undefined ? [test] : []);
  const style = logStyle ?? test.value;
  return (
    <div data-agent-detail="" className="flex min-h-0 flex-1 flex-col">
      <LogViewer session={session} logStyle={style} />
      <Composer session={session} />
    </div>
  );
}
