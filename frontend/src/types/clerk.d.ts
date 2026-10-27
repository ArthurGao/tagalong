// Our session token adds `"metadata": "{{user.public_metadata}}"` (Clerk Dashboard → Sessions),
// so the role the backend mirrors to publicMetadata is readable in proxy.ts without a request.
export {};

declare global {
  interface CustomJwtSessionClaims {
    metadata?: { role?: 'merchant' | 'admin' };
  }
}
