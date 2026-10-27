import createClient from 'openapi-fetch';
import { BACKEND_URL } from '../backend-url';
import type { paths } from './schema';

// Browser: relative /api/v1 paths go through the Next rewrite (same origin, cookies work).
// Server: call the backend directly.
export const api = createClient<paths>({
  baseUrl: typeof window === 'undefined' ? BACKEND_URL : '',
});
