/** Emails are compared and stored lower-cased (User.email is unique). */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
