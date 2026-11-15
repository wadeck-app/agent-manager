/** The two letters of the rail monogram: the first two characters of the folder as written (no case change), after any leading punctuation. */
export function monogram(folder: string): string {
  return Array.from(folder.replace(/^[^\p{L}\p{N}]+/u, '')).slice(0, 2).join('');
}
