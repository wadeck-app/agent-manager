import { matchPositions } from '../logic/fuzzy.js';

/** The text with the letters of the search words in bold and the primary colour (a text attribute, not a colour alone: the weight shows without it). */
export function Highlight({ text, terms }: { text: string; terms?: readonly string[] }) {
  if (terms === undefined || terms.length === 0) {
    return <>{text}</>;
  }
  const lit = new Set(matchPositions(terms, text));
  if (lit.size === 0) {
    return <>{text}</>;
  }
  const parts: { text: string; lit: boolean }[] = [];
  Array.from(text).forEach((char, index) => {
    const last = parts[parts.length - 1];
    if (last !== undefined && last.lit === lit.has(index)) {
      last.text += char;
    } else {
      parts.push({ text: char, lit: lit.has(index) });
    }
  });
  return (
    <>
      {parts.map((part, index) =>
        part.lit ? (
          <span key={index} data-match="" className="font-bold text-primary">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
