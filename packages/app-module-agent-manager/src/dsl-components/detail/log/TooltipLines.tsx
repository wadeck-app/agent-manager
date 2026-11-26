/** A tooltip text with one line per call (a group): the card collapses newlines, so each line is a block. */
export function TooltipLines({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, index) => (
        <div key={index} className="text-left">
          {line}
        </div>
      ))}
    </>
  );
}
