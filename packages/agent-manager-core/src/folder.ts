/** The last directory of a path, whatever the separators (backslash or slash); a root or an empty path is returned as it is. */
export function lastDirectory(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '');
  return parts.length === 0 ? path : parts[parts.length - 1]!;
}
