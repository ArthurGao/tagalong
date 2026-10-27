import { describe, expect, it, vi } from 'vitest';
import { extractFontUrl, loadCjkFont } from './og-font';

describe('extractFontUrl', () => {
  it('picks the truetype source out of a css2 response', () => {
    const css = `@font-face {
  font-family: 'Noto Sans SC';
  src: url(https://fonts.gstatic.com/l/font?kit=abc&skey=1&v=v39) format('truetype');
}`;
    expect(extractFontUrl(css)).toBe('https://fonts.gstatic.com/l/font?kit=abc&skey=1&v=v39');
  });

  it('returns null for woff2-only responses, which Satori cannot render', () => {
    expect(extractFontUrl("src: url(https://fonts.gstatic.com/x.woff2) format('woff2');")).toBeNull();
  });
});

describe('loadCjkFont', () => {
  it('needs no network for Latin-only text (the default font covers it)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
    expect(await loadCjkFont('Cherries 2kg – $39.00 · 5 left')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
