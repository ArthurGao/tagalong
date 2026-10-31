/** `path` with the current query changed: undefined or empty values are dropped, so filters and drawers compose. */
export function queryHref(path: string, current: Record<string, string | undefined>, changes: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...changes })) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Whether a search param can be an id: admin pages fetch a drawer's row only for a UUID. */
export const isUuid = (value: string | undefined): value is string =>
  value !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** One value of a Next.js search param (the first, when repeated). */
export const firstParam = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
