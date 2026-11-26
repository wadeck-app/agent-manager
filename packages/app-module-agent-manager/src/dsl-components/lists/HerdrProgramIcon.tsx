import { Tooltip } from '@wadeck-app/dsl-ui';
import { Asterisk, SquareTerminal } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { harnessChip } from '../detail/status/harness.js';
import { HOST_LABEL } from '../logic/owned.js';

/** The program of the session as an icon: the Claude mark (an asterisk) in orange for Claude Code, a terminal for any other program; the words are the tooltip. */
export function HerdrProgramIcon({ session }: { session: AgentRow }) {
  const claude = session.harness === undefined || session.harness.toLowerCase().startsWith('claude');
  const program = session.harness === undefined ? 'Claude Code' : harnessChip(session.harness).full;
  // The host of a session launched from agent-manager (Web, Terminal, Background) is part of the tooltip: the row keeps its room for the name.
  const full = session.launchedBy === 'agent-manager' && session.host !== null ? `${program}, ${HOST_LABEL[session.host]} session` : program;
  const Icon = claude ? Asterisk : SquareTerminal;
  return (
    <Tooltip content={full} side="left">
      <span className="inline-flex shrink-0">
        <Icon aria-hidden="true" className={`h-4 w-4 ${claude ? 'text-hue-orange' : 'text-muted'}`} />
        <span className="sr-only">{full}</span>
      </span>
    </Tooltip>
  );
}
