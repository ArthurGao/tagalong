/** Emails are compared and stored lower-cased (User.email is unique). */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Erased buyer addresses end here (DESIGN §9 anonymisation): under the reserved `.invalid` TLD, so never mailed. */
export const ANONYMIZED_EMAIL_DOMAIN = 'anonymized.invalid';
/** An address under `.invalid` (RFC 2606) can never receive mail; NotificationsService drops it instead of queueing. */
export const isUndeliverableEmail = (email: string): boolean => email.trim().toLowerCase().endsWith('.invalid');
