/** An error as a short line for a queue row's `lastError`. */
export function errorText(e: unknown, max = 500): string {
  return e instanceof Error ? e.message.slice(0, max) : String(e);
}
