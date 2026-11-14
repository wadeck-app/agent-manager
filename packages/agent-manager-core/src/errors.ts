/** The message of anything that was thrown: the message of an Error, else the thrown value as text. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
