import { TriangleAlert } from 'lucide-react';
import { Tooltip } from '../deps.js';
import type { ModelDto } from '../deps.js';
import { CHIP, CHIP_ICON, CHIP_WARNING } from './chipStyle.js';

/** The current model. An id that is not in the table is shown raw, with a warning look and a tooltip that says so. Earlier models are in the tooltip. */
export function ModelChip({ model, previous }: { model: ModelDto; previous: readonly ModelDto[] | undefined }) {
  const earlier = (previous ?? []).filter((entry) => entry.displayName !== model.displayName);
  const history = earlier.length === 0 ? '' : ` Before: ${earlier.map((entry) => entry.displayName).join(', ')}.`;
  if (!model.known) {
    return (
      <Tooltip content={`Unrecognised model id: ${model.id ?? model.displayName}. It is not in this page's model table, so the id is shown as it is.${history}`}>
        <span tabIndex={0} aria-label={`Model, unrecognised id ${model.displayName}`} className={CHIP_WARNING}>
          <TriangleAlert aria-hidden="true" className={CHIP_ICON} />
          {model.displayName}
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={`Model in use${model.id === undefined ? '' : ` (${model.id})`}.${history}`}>
      <span tabIndex={0} aria-label={`Model ${model.displayName}`} className={CHIP}>
        {model.displayName}
      </span>
    </Tooltip>
  );
}
