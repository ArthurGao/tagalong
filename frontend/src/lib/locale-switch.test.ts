import { describe, expect, it } from 'vitest';
import { otherLocale, switchLocalePath } from './locale-switch';

describe('switching language', () => {
  it('keeps the page and its query string, swapping only the locale', () => {
    expect(switchLocalePath('/zh-CN/o/TA-K7M2Q9', '?t=abc&paid=1', 'en')).toBe('/en/o/TA-K7M2Q9?t=abc&paid=1');
    expect(switchLocalePath('/en/dashboard/listings', '', 'zh-CN')).toBe('/zh-CN/dashboard/listings');
    expect(switchLocalePath('/en', '', 'zh-CN')).toBe('/zh-CN');
  });

  it('adds the locale to a path without one', () => {
    expect(switchLocalePath('/l/abc12345', '', 'en')).toBe('/en/l/abc12345');
  });

  it('flips between the two languages', () => {
    expect(otherLocale('zh-CN')).toBe('en');
    expect(otherLocale('en')).toBe('zh-CN');
  });
});
