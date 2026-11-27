import { Banner, type BannerTone } from '../ui/Banner.js';
import { mergeReadProblems, type ReadProblemLine } from './batchBypass.js';

/**
 * The reads that failed in a batch dialog, in ONE banner: what the dialog does about them, a line per failed read (the sessions, the server's words), then the
 * fix they all share once. Nothing is shown without a problem.
 */
export function ReadProblems({ tone, intro, outro, problems }: { tone: BannerTone; intro: string; outro: string; problems: readonly ReadProblemLine[] }) {
  if (problems.length === 0) {
    return null;
  }
  const merged = mergeReadProblems(problems);
  return (
    <Banner tone={tone}>
      <div data-read-problems="" className="flex flex-col gap-1">
        {intro === '' ? null : <p>{intro}</p>}
        <ul className="flex flex-col gap-1">
          {merged.lines.map((line) => (
            <li key={`${line.who}|${line.text}`}>
              <span className="font-medium">{line.who}</span>
              {`: ${line.text}`}
            </li>
          ))}
        </ul>
        {merged.shared === '' ? null : <p>{merged.shared}</p>}
        {outro === '' ? null : <p>{outro}</p>}
      </div>
    </Banner>
  );
}
