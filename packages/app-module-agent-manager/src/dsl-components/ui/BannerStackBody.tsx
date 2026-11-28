import { ButtonAction } from '@wadeck-app/dsl-ui';
import { prose } from '../logic/prose.js';
import { Banner } from './Banner.js';
import { headlineOf, type StackedItem } from './bannerStackKit.js';

const TOGGLE = 'shrink-0 self-start';

/** The one banner: the worst tone, the title of the first message and the count of the others, or every message whole when it is open. */
export function BannerStackBody({ entries, first, open, onToggle, run }: { entries: [string, StackedItem][]; first: [string, StackedItem]; open: boolean; onToggle: () => void; run: (id: string) => void }) {
  const [firstId, firstItem] = first;
  const more = entries.length - 1;
  const title = headlineOf(firstItem.text);
  // Something is hidden when there are other messages, or when the first has more to say than its title.
  const foldable = more > 0 || prose(firstItem.text) !== title;
  const tone = firstItem.tone;
  const action = (id: string, item: StackedItem) => (item.actionLabel === undefined ? null : <ButtonAction variant="secondary" size="sm" label={item.actionLabel} onClick={() => run(id)} />);
  return (
    <Banner
      tone={tone}
      action={
        <>
          {foldable ? (
            <span className={TOGGLE}>
              <ButtonAction variant="link" underline="always" size="xs" ariaExpanded={open} onClick={onToggle} label={open ? 'Show less' : more > 0 ? `Show all ${entries.length}` : 'Show more'} />
            </span>
          ) : null}
          {open ? null : action(firstId, firstItem)}
        </>
      }
    >
      {open ? (
        <ul className="flex flex-col gap-1.5">
          {entries.map(([id, item]) => (
            <li key={id} data-stacked-item={item.tone} className="flex flex-wrap items-start gap-x-2">
              <span className="min-w-[10rem] flex-1">{prose(item.text)}</span>
              {action(id, item)}
            </li>
          ))}
        </ul>
      ) : (
        <span data-folded="true">
          {title}
          {more > 0 ? <span className="ml-1 whitespace-nowrap font-semibold">{`and ${more} more`}</span> : null}
        </span>
      )}
    </Banner>
  );
}
