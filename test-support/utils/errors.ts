/** The message of anything that was thrown: the message of an Error, else the thrown value as text. */
export function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
