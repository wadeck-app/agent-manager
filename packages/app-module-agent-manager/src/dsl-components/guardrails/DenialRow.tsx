import { Tooltip } from '@wadeck-app/dsl-ui';
import { Ban, CircleHelp } from 'lucide-react';
import { useState } from 'react';
import { folderName } from '../logic/folderPicker.js';
import { clockText, previewOf, subagentOf } from '../logic/guardrails.js';
import type { DenialDto } from '../shared.js';
import { MONO, TD } from './parts.js';
import { RowButton } from '../ui/RowButton.js';

/** One denial or ask of the timeline: time, decision, category, session, tool, project, and the command (when the PIN route gave it, cut with "Show full") or the file. */
export function DenialRow({ denial, withCommands }: { denial: DenialDto; withCommands: boolean }) {
  const [full, setFull] = useState(false);
  const sub = subagentOf(denial.session);
  const Icon = denial.decision === 'deny' ? Ban : CircleHelp;
  const detail = denial.command !== undefined ? previewOf(denial.command, full) : undefined;
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className={`${TD} whitespace-nowrap tabular-nums`}>{clockText(denial.at)}</td>
      <td className={TD}>
        <Tooltip content={denial.decision === 'deny' ? 'Denied' : 'Asked the user'} describe={false}>
          <span className="flex items-center gap-1">
            <Icon aria-hidden="true" className={`h-am-icon-sm w-am-icon-sm ${denial.decision === 'deny' ? 'text-hue-red' : 'text-hue-orange'}`} />
            <span>{denial.decision === 'deny' ? 'Denied' : 'Asked'}</span>
          </span>
        </Tooltip>
      </td>
      <td className={`${TD} font-medium`}>{denial.category}</td>
      <td className={TD}>
        <span className="flex flex-col">
          <Tooltip content={denial.session}>
            <span className={MONO}>{denial.prefix}</span>
          </Tooltip>
          {denial.sessionName !== '' ? <span className="text-xs text-muted">{denial.sessionName}</span> : null}
          {sub !== '' ? <span className="text-xs text-muted">sub-agent {sub}</span> : null}
        </span>
      </td>
      <td className={TD}>{denial.tool}</td>
      <td className={TD}>
        <Tooltip content={denial.project}>
          <span>{folderName(denial.project)}</span>
        </Tooltip>
      </td>
      <td className={`${TD} max-w-2xl break-all`}>
        {denial.file !== '' ? <span className={MONO}>{denial.file}</span> : null}
        {detail !== undefined ? (
          <span className="flex flex-wrap items-start gap-2">
            <span className={`${MONO} whitespace-pre-wrap break-all`}>{detail.text}</span>
            {detail.cut || full ? (
              <RowButton type="button" onClick={() => setFull((value) => !value)} className="text-xs text-primary underline">
                {full ? 'Show less' : 'Show full'}
              </RowButton>
            ) : null}
          </span>
        ) : denial.file === '' ? (
          <span className="text-muted">{denial.hasCommand && !withCommands ? 'Command hidden: turn on Show commands (PIN)' : 'no command'}</span>
        ) : null}
      </td>
    </tr>
  );
}
