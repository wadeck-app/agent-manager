import { sessionsOf } from './batchBypass.js';

/** The names of the selected sessions: listed up to 5, behind a native disclosure (keyboard and screen reader friendly) above. */
export function SessionNames({ names }: { names: readonly string[] }) {
  const list = (
    <ul aria-label="Selected sessions" className="flex flex-col gap-0.5 text-sm text-content">
      {names.map((name, index) => (
        // The same name may appear twice (two sessions of one folder): the index keeps the keys apart.
        <li key={`${name}-${index}`} className="truncate">
          {name}
        </li>
      ))}
    </ul>
  );
  if (names.length <= 5) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-content">{sessionsOf(names.length)}</p>
        {list}
      </div>
    );
  }
  return (
    <details className="rounded border border-border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-content">{sessionsOf(names.length)}</summary>
      <div className="mt-2 max-h-48 overflow-y-auto">{list}</div>
    </details>
  );
}
