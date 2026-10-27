// The UI languages (frontend next-intl `routing.locales`). Stored on orders for emails sent later (DESIGN §12).
export const LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh-CN';
