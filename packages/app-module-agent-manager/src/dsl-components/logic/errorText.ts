/**
 * The message of anything that was thrown: the message of an Error, else the thrown value as text. Same as getErrorMessage of agent-manager-core,
 * kept here because the core package root also exports file system code that must not enter the browser bundle.
 */
export function getErrorMessage(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
