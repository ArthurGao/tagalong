/** `path` with the current query changed: undefined or empty values are dropped, so filters and drawers compose. */
export function queryHref(path: string, current: Record<string, string | undefined>, changes: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...changes })) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** One value of a Next.js search param (the first, when repeated). */
export const firstParam = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
