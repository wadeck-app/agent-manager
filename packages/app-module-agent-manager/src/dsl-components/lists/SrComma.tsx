/** The text of a screen reader between the name and the secondary text of a row, so that its accessible name reads "name, folder" whatever the look (the A/B question `ui-row-separator`). */
export function SrComma() {
  return <span className="sr-only">, </span>;
}
