import { Switch } from '@wadeck-app/dsl-ui';

/** One on/off view option (a switch), with a one-line explanation under its label. */
export function OptionToggle({ checked, onToggle, label, hint }: { checked: boolean; onToggle: (checked: boolean) => void; label: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded px-2 py-1.5 hover:bg-muted-bg">
      <Switch size="sm" label={label} checked={checked} onChange={onToggle} />
      <span className="pl-11 text-xs text-muted">{hint}</span>
    </div>
  );
}
