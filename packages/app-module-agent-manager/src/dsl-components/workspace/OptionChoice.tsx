import { FOCUS_RING } from '../ui/IconButton.js';

/** One radio choice of a view option, with a one-line hint under its label. */
export function OptionChoice({ name, checked, onSelect, label, hint }: { name: string; checked: boolean; onSelect: () => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-muted-bg">
      <input type="radio" name={name} checked={checked} onChange={onSelect} className={`mt-1 accent-primary ${FOCUS_RING}`} />
      <span className="flex flex-col">
        <span className="text-sm text-content">{label}</span>
        {hint !== undefined ? <span className="text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
