import { FOCUS_RING } from '../ui/IconButton.js';

/** One on/off view option (a switch), with a one-line explanation under its label. */
export function OptionToggle({ checked, onToggle, label, hint }: { checked: boolean; onToggle: (checked: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-muted-bg">
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onToggle(event.target.checked)} className={`mt-1 accent-primary ${FOCUS_RING}`} />
      <span className="flex flex-col">
        <span className="text-sm text-content">{label}</span>
        <span className="text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}
