/** What went wrong, as text, from anything a `catch` can hold. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
