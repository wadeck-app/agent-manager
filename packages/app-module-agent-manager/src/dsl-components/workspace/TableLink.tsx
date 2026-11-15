import { Table2 } from 'lucide-react';
import { Link, useInRouterContext } from 'react-router-dom';
import { ICON_BUTTON_CLASS } from '../ui/IconButton.js';
import { Tooltip } from '../ui/Tooltip.js';

/** The table of the sessions is a page of its own (extension point `/agents/table`, nav label "Agents table"). */
export const TABLE_PAGE_HREF = '/modules/agent-manager/agents/table';

/** The icon link to the table page. In the shell it is a router link (no reload); without a router (a test, a standalone render) a plain link. */
export function TableLink() {
  const inRouter = useInRouterContext();
  const icon = <Table2 aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />;
  return (
    <Tooltip content="Agents table">
      {inRouter ? (
        <Link to={TABLE_PAGE_HREF} aria-label="Agents table" className={ICON_BUTTON_CLASS}>
          {icon}
        </Link>
      ) : (
        <a href={TABLE_PAGE_HREF} aria-label="Agents table" className={ICON_BUTTON_CLASS}>
          {icon}
        </a>
      )}
    </Tooltip>
  );
}
